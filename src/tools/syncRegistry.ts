import { z } from "zod";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  githubFetch,
  githubWrite,
  errorResponse,
} from "../utils/github.js";

const META_OWNER = "TMHSDigital";
const META_REPO = "Developer-Tools-Directory";
const PYTHON = process.platform === "win32" ? "python" : "python3";

// Files that sync_from_registry.py regenerates
const SYNC_FILES = ["README.md", "CLAUDE.md", "docs/index.html"];

interface GitRef {
  object: { sha: string };
}

interface FileContents {
  content: string;
  sha: string;
  encoding: string;
}

interface PullRequest {
  number: number;
  head: { sha: string };
}

interface CheckRuns {
  check_runs: Array<{ name: string; conclusion: string | null; status: string }>;
}

function metaRoot(): string | null {
  return process.env.DEVTOOLS_META_ROOT ?? null;
}

function token(): string | null {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
}

function runSync(meta: string, checkOnly: boolean): { stdout: string; stderr: string; code: number } {
  const scriptPath = join(meta, "scripts", "sync_from_registry.py");
  const args = checkOnly ? [scriptPath, "--check"] : [scriptPath];
  const result = spawnSync(PYTHON, args, { encoding: "utf-8", timeout: 30_000 });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 2 };
}

function computeEditDiff(
  registry: Record<string, unknown>[],
  edit: Record<string, Record<string, unknown>>,
): Array<{ slug: string; field: string; from: unknown; to: unknown }> {
  const diff: Array<{ slug: string; field: string; from: unknown; to: unknown }> = [];
  for (const [slug, fields] of Object.entries(edit)) {
    const entry = registry.find((e) => (e as { slug: string }).slug === slug) as Record<string, unknown> | undefined;
    if (!entry) continue;
    for (const [field, newVal] of Object.entries(fields)) {
      if (JSON.stringify(entry[field]) !== JSON.stringify(newVal)) {
        diff.push({ slug, field, from: entry[field], to: newVal });
      }
    }
  }
  return diff;
}

async function waitForMetaPR(prNumber: number, headSha: string): Promise<void> {
  const checkPath = `/repos/${META_OWNER}/${META_REPO}/commits/${headSha}/check-runs`;
  const REQUIRED = ["Validate registry.json", "Registry sync check", "Public-repo safety scan"];

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const data = await githubFetch<CheckRuns>(checkPath);
      const runs = data.check_runs;
      const allDone = runs.every((c) => c.status === "completed");
      const anyFailed = runs.some(
        (c) => c.conclusion === "failure" || c.conclusion === "action_required",
      );
      if (anyFailed) throw new Error(`A required check failed on meta PR #${prNumber}`);
      const requiredDone = REQUIRED.every((name) => {
        const run = runs.find((c) => c.name === name);
        return run?.status === "completed" && run?.conclusion === "success";
      });
      if (allDone && requiredDone) return;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("A required check")) throw e;
    }
  }
  throw new Error(`Timed out waiting for meta PR #${prNumber} checks`);
}

async function openAndMergeMetaPR(
  branchName: string,
  title: string,
  body: string,
): Promise<void> {
  const pr = await githubWrite<PullRequest>(`/repos/${META_OWNER}/${META_REPO}/pulls`, "POST", {
    title,
    body,
    head: branchName,
    base: "main",
  });

  const prData = await githubFetch<PullRequest>(
    `/repos/${META_OWNER}/${META_REPO}/pulls/${pr.number}`,
  );

  await waitForMetaPR(pr.number, prData.head.sha);

  await githubWrite(`/repos/${META_OWNER}/${META_REPO}/pulls/${pr.number}/merge`, "PUT", {
    merge_method: "squash",
  });

  try {
    await githubWrite(
      `/repos/${META_OWNER}/${META_REPO}/git/refs/heads/${branchName}`,
      "DELETE",
    );
  } catch {
    // Best-effort cleanup
  }
}

const inputSchema = {
  edit: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "Registry field updates keyed by slug. Example: {\"steam-mcp\": {\"version\": \"1.1.0\"}}. " +
        "Only updates existing entries. Slug must already exist in registry.json.",
    ),
  apply: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true to apply edits to registry.json, run sync_from_registry.py, and open a meta-repo PR. " +
        "Dry-run by default. Requires DEVTOOLS_META_ROOT and GH_TOKEN.",
    ),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_syncRegistry",
    "Preview or apply registry.json field edits and regenerate derived artifacts (README, CLAUDE.md, docs/index.html). " +
      "Boundary: updates EXISTING entries only. Rejects slugs not already in registry.json. " +
      "Dry-run calls sync_from_registry.py --check and reports the diff without committing. " +
      "Apply writes the edits, regenerates artifacts, and opens a meta-repo PR that is squash-merged when CI passes. " +
      "Requires DEVTOOLS_META_ROOT and GH_TOKEN.",
    inputSchema,
    async ({ edit, apply }) => {
      try {
        const meta = metaRoot();
        if (!meta) {
          return errorResponse(
            new Error(
              "DEVTOOLS_META_ROOT is not set. " +
                "Point it to your local clone of TMHSDigital/Developer-Tools-Directory.",
            ),
          );
        }

        const registryPath = join(meta, "registry.json");
        let registryRaw: string;
        try {
          registryRaw = readFileSync(registryPath, "utf-8");
        } catch {
          return errorResponse(new Error(`Cannot read registry.json from ${registryPath}`));
        }

        const registry = JSON.parse(registryRaw) as Record<string, unknown>[];

        // Validate all edited slugs exist
        if (edit) {
          for (const slug of Object.keys(edit)) {
            if (!registry.some((e) => (e as { slug: string }).slug === slug)) {
              return errorResponse(
                new Error(
                  `Slug "${slug}" not found in registry.json. ` +
                    "syncRegistry only updates existing entries. Use createTool to add a new repo.",
                ),
              );
            }
          }
        }

        const editDiff = edit ? computeEditDiff(registry, edit) : [];

        if (!apply) {
          // Dry-run: show field diff + run sync --check with edited registry
          let syncCheckCode = -1;
          let syncCheckMessage = "DEVTOOLS_META_ROOT not set; skipping sync check";

          const originalContent = registryRaw;
          let tempWritten = false;
          try {
            if (edit && editDiff.length > 0) {
              // Apply edits to in-memory copy, write temporarily
              const edited = registry.map((entry) => {
                const slug = (entry as { slug: string }).slug;
                if (edit[slug]) return { ...entry, ...edit[slug] };
                return entry;
              });
              writeFileSync(registryPath, JSON.stringify(edited, null, 2) + "\n", "utf-8");
              tempWritten = true;
            }

            const syncResult = runSync(meta, true);
            syncCheckCode = syncResult.code;
            syncCheckMessage =
              syncCheckCode === 0
                ? "sync --check passed: artifacts are in sync with (edited) registry"
                : `sync --check exit ${syncCheckCode}: artifacts would need regeneration`;
          } finally {
            if (tempWritten) writeFileSync(registryPath, originalContent, "utf-8");
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    apply: false,
                    editDiff,
                    syncCheckPassed: syncCheckCode === 0,
                    syncCheckMessage,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Apply mode
        const ghToken = token();
        if (!ghToken) {
          return errorResponse(
            new Error("GH_TOKEN or GITHUB_TOKEN is required for apply mode."),
          );
        }

        // Apply edits to registry.json on disk
        if (edit && editDiff.length > 0) {
          const edited = registry.map((entry) => {
            const slug = (entry as { slug: string }).slug;
            if (edit[slug]) return { ...entry, ...edit[slug] };
            return entry;
          });
          writeFileSync(registryPath, JSON.stringify(edited, null, 2) + "\n", "utf-8");
        }

        // Regenerate artifacts
        const syncResult = runSync(meta, false);
        if (syncResult.code !== 0) {
          return errorResponse(
            new Error(`sync_from_registry.py failed (exit ${syncResult.code}): ${syncResult.stderr.trim()}`),
          );
        }

        // Verify artifacts are now in sync
        const verifyResult = runSync(meta, true);
        if (verifyResult.code !== 0) {
          return errorResponse(
            new Error("sync_from_registry.py --check failed after regeneration. Aborting."),
          );
        }

        // Collect changed file contents for GitHub API push
        const changedFiles: Array<{ path: string; content: string }> = [];
        for (const filePath of ["registry.json", ...SYNC_FILES]) {
          try {
            const content = readFileSync(join(meta, filePath), "utf-8");
            changedFiles.push({ path: filePath, content });
          } catch {
            // File may not exist (e.g. docs/index.html in minimal checkout)
          }
        }

        // Create branch on meta-repo
        const slugList = edit ? Object.keys(edit).join("-") : "resync";
        const branchName = `chore/sync-registry-${slugList}`;
        const refData = await githubFetch<GitRef>(
          `/repos/${META_OWNER}/${META_REPO}/git/ref/heads/main`,
        );
        const headSha = refData.object.sha;
        await githubWrite(`/repos/${META_OWNER}/${META_REPO}/git/refs`, "POST", {
          ref: `refs/heads/${branchName}`,
          sha: headSha,
        });

        // Push each file to the branch
        for (const { path: filePath, content } of changedFiles) {
          let fileSha: string | undefined;
          try {
            const fileData = await githubFetch<FileContents>(
              `/repos/${META_OWNER}/${META_REPO}/contents/${filePath}`,
            );
            fileSha = fileData.sha;
          } catch {
            // File does not exist on remote yet (unlikely for these files)
          }

          const encoded = Buffer.from(content, "utf-8").toString("base64");
          const body: Record<string, unknown> = {
            message: `chore: sync registry artifacts [skip ci]`,
            content: encoded,
            branch: branchName,
          };
          if (fileSha) body.sha = fileSha;

          await githubWrite(
            `/repos/${META_OWNER}/${META_REPO}/contents/${filePath}`,
            "PUT",
            body,
          );
        }

        const editSummary =
          editDiff.length > 0
            ? editDiff.map((d) => `${d.slug}.${d.field}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`).join(", ")
            : "no field edits (pure resync)";

        await openAndMergeMetaPR(
          branchName,
          `chore: sync registry artifacts${edit ? ` (${Object.keys(edit).join(", ")})` : ""} [skip ci]`,
          `Registry sync via devtools_syncRegistry.\n\nChanges: ${editSummary}`,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  apply: true,
                  editDiff,
                  filesUpdated: changedFiles.map((f) => f.path),
                  status: "merged",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
