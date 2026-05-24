import { z } from "zod";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  fetchStandardsVersion,
  githubFetch,
  githubWrite,
  errorResponse,
} from "../utils/github.js";

const META_OWNER = "TMHSDigital";
const META_REPO = "Developer-Tools-Directory";
const PYTHON = process.platform === "win32" ? "python" : "python3";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

interface DriftConfig {
  types?: Record<string, { required_workflows?: string[] }>;
}

function metaRoot(): string | null {
  return process.env.DEVTOOLS_META_ROOT ?? null;
}

function token(): string | null {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function listFiles(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFiles(full, base));
    } else {
      results.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

function runScaffold(
  meta: string,
  name: string,
  slug: string,
  type: string,
  description: string,
  license: string,
  outputDir: string,
): { stdout: string; stderr: string; code: number } {
  const scriptPath = join(meta, "scaffold", "create-tool.py");
  const args = [
    scriptPath,
    "--name", name,
    "--slug", slug,
    "--type", type,
    "--description", description,
    "--license", license,
    "--output", outputDir,
  ];
  const result = spawnSync(PYTHON, args, { encoding: "utf-8", timeout: 30_000 });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 2 };
}

async function waitForMetaPR(prNumber: number, headSha: string): Promise<void> {
  const checkPath = `/repos/${META_OWNER}/${META_REPO}/commits/${headSha}/check-runs`;
  const REQUIRED = ["Validate registry.json", "Registry sync check", "Public-repo safety scan"];

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const data = await githubFetch<CheckRuns>(checkPath);
      const runs = data.check_runs;
      const anyFailed = runs.some(
        (c) => c.conclusion === "failure" || c.conclusion === "action_required",
      );
      if (anyFailed) throw new Error(`A required check failed on meta PR #${prNumber}`);
      const allDone = runs.every((c) => c.status === "completed");
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

function buildWouldBeEntry(
  name: string,
  slug: string,
  type: string,
  description: string,
  license: string,
): Record<string, unknown> {
  return {
    name,
    repo: `${META_OWNER}/${slug}`,
    slug,
    description,
    type,
    homepage: type === "mcp-server" ? "" : `https://${META_OWNER.toLowerCase()}.github.io/${slug}/`,
    skills: 0,
    rules: 0,
    mcpTools: 0,
    extras: {},
    topics: [],
    status: "experimental",
    version: "0.1.0",
    language: type === "mcp-server" ? "TypeScript" : "Python",
    license: license.toUpperCase(),
    pagesType: type === "mcp-server" ? "none" : "static",
    hasCI: true,
  };
}

const inputSchema = {
  name: z.string().min(1).describe("Display name, e.g. 'Example MCP Server'"),
  slug: z
    .string()
    .optional()
    .describe("Kebab-case slug (auto-derived from name if omitted). Must be unique in the registry."),
  type: z
    .enum(["cursor-plugin", "mcp-server"])
    .default("cursor-plugin")
    .describe("Repository type"),
  description: z.string().min(1).describe("One-line description for the new tool"),
  license: z
    .string()
    .optional()
    .default("cc-by-nc-nd-4.0")
    .describe("SPDX license identifier (default: cc-by-nc-nd-4.0)"),
  apply: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true to create the real GitHub repo and register it. " +
        "Dry-run by default. Requires confirm=true AND a token with repo-creation scope.",
    ),
  confirm: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Must be true when apply=true. Guards against accidental public repo creation. " +
        "The gh repo create step is IRREVERSIBLE.",
    ),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_createTool",
    "Plan or execute creation of a new ecosystem tool repo. " +
      "Dry-run (default): validates inputs, runs scaffold/create-tool.py to a temp dir to prove the scaffold " +
      "works, lists all files that would be generated, computes the would-be registry entry, " +
      "reports the standards-version the repo would start at, and describes the branch protection " +
      "and required checks it would receive. Creates nothing. " +
      "Apply (apply=true AND confirm=true): creates a real public GitHub repo (IRREVERSIBLE), " +
      "scaffolds and bootstraps it, applies branch protection matching the type, " +
      "registers it in registry.json, and opens+merges the meta-repo PR. " +
      "Requires DEVTOOLS_META_ROOT for both modes. Requires GH_TOKEN with repo-creation scope for apply.",
    inputSchema,
    async ({ name, slug: slugArg, type, description, license, apply, confirm }) => {
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

        const slug = slugArg ?? slugify(name);
        if (!SLUG_RE.test(slug)) {
          return errorResponse(
            new Error(
              `Derived slug "${slug}" is not valid kebab-case. ` +
                "Provide --slug explicitly or adjust the name.",
            ),
          );
        }

        const registry = await fetchRegistry();
        if (registry.some((e) => e.slug === slug)) {
          return errorResponse(
            new Error(
              `Slug "${slug}" already exists in registry.json. ` +
                "Choose a different slug or use syncRegistry to update the existing entry.",
            ),
          );
        }

        const standardsVersion = await fetchStandardsVersion();

        // Read drift config to describe required workflows
        let requiredWorkflows: string[] = [];
        try {
          const configRaw = readFileSync(
            join(meta, "standards", "drift-checker.config.json"),
            "utf-8",
          );
          const config = JSON.parse(configRaw) as DriftConfig;
          requiredWorkflows = config.types?.[type]?.required_workflows ?? [];
        } catch {
          // Drift config unavailable; report empty
        }

        const wouldBeEntry = buildWouldBeEntry(name, slug, type, description, license);

        // Dry-run: scaffold to temp dir
        const tmpBase = tmpdir();
        const tmpDir = mkdtempSync(join(tmpBase, "devtools-create-"));
        let scaffoldedFiles: string[] = [];
        let scaffoldError: string | null = null;

        try {
          const result = runScaffold(meta, name, slug, type, description, license, tmpDir);
          if (result.code === 0) {
            const slugDir = join(tmpDir, slug);
            scaffoldedFiles = listFiles(slugDir);
          } else {
            scaffoldError = result.stderr.trim() || result.stdout.trim();
          }
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }

        if (!apply) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    apply: false,
                    plan: {
                      name,
                      slug,
                      type,
                      description,
                      license,
                      githubRepo: `${META_OWNER}/${slug}`,
                      standardsVersionAtCreation: standardsVersion,
                      wouldBeRegistryEntry: wouldBeEntry,
                      scaffoldedFiles: scaffoldError
                        ? { error: scaffoldError }
                        : scaffoldedFiles,
                      branchProtection: {
                        description:
                          "main protection ruleset: block direct push, require PR + squash, " +
                          "empty bypass list",
                        requiredStatusChecks: requiredWorkflows,
                      },
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Apply path: confirm + token required
        if (!confirm) {
          return errorResponse(
            new Error(
              "apply=true requires confirm=true. " +
                "gh repo create is IRREVERSIBLE. Set confirm=true only when ready.",
            ),
          );
        }

        const ghToken = token();
        if (!ghToken) {
          return errorResponse(
            new Error("GH_TOKEN or GITHUB_TOKEN with repo-creation scope is required for apply."),
          );
        }

        if (scaffoldError) {
          return errorResponse(
            new Error(`Scaffold failed during dry-run pre-check: ${scaffoldError}`),
          );
        }

        // STEP 1: Create GitHub repo (IRREVERSIBLE)
        const ghCreateResult = spawnSync(
          "gh",
          ["repo", "create", `${META_OWNER}/${slug}`, "--public", "--confirm"],
          { encoding: "utf-8", timeout: 60_000, env: { ...process.env, GH_TOKEN: ghToken } },
        );
        if (ghCreateResult.status !== 0) {
          return errorResponse(
            new Error(
              `gh repo create failed: ${ghCreateResult.stderr.trim() || ghCreateResult.stdout.trim()}`,
            ),
          );
        }

        // STEP 2: Scaffold to a fresh temp dir
        const scaffoldTmp = mkdtempSync(join(tmpdir(), "devtools-scaffold-"));
        try {
          const result = runScaffold(meta, name, slug, type, description, license, scaffoldTmp);
          if (result.code !== 0) {
            return errorResponse(new Error(`Scaffold failed: ${result.stderr.trim()}`));
          }

          const repoDir = join(scaffoldTmp, slug);

          // STEP 3: Bootstrap onto fresh repo main (direct push allowed before protection)
          const gitSteps = [
            ["git", "init"],
            ["git", "add", "."],
            ["git", "commit", "-s", "-m", `chore: initial scaffold at standards-version ${standardsVersion}`],
            ["git", "remote", "add", "origin", `https://x-access-token:${ghToken}@github.com/${META_OWNER}/${slug}.git`],
            ["git", "push", "-u", "origin", "main"],
          ];
          for (const [cmd, ...args] of gitSteps) {
            const r = spawnSync(cmd, args, { cwd: repoDir, encoding: "utf-8", timeout: 60_000 });
            if (r.status !== 0) {
              return errorResponse(
                new Error(`Bootstrap step "${cmd} ${args[0]}" failed: ${r.stderr.trim()}`),
              );
            }
          }
        } finally {
          rmSync(scaffoldTmp, { recursive: true, force: true });
        }

        // STEP 4: Apply branch protection via GitHub Rulesets API
        await githubWrite(`/repos/${META_OWNER}/${slug}/rulesets`, "POST", {
          name: "main protection",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
          rules: [
            { type: "deletion" },
            { type: "non_fast_forward" },
            { type: "required_linear_history" },
            {
              type: "pull_request",
              parameters: {
                required_approving_review_count: 0,
                dismiss_stale_reviews_on_push: false,
                require_code_owner_review: false,
                require_last_push_approval: false,
                required_review_thread_resolution: false,
                allowed_merge_methods: ["squash"],
              },
            },
          ],
          bypass_actors: [],
        });

        // STEP 5: Register in registry.json + sync + meta PR
        const registryPath = join(meta, "registry.json");
        const registryRaw = readFileSync(registryPath, "utf-8");
        const registryData = JSON.parse(registryRaw) as Record<string, unknown>[];
        registryData.push(wouldBeEntry);
        writeFileSync(registryPath, JSON.stringify(registryData, null, 2) + "\n", "utf-8");

        // Regenerate artifacts
        const syncScript = join(meta, "scripts", "sync_from_registry.py");
        const syncResult = spawnSync(PYTHON, [syncScript], { encoding: "utf-8", timeout: 30_000 });
        if (syncResult.status !== 0) {
          return errorResponse(new Error(`sync_from_registry.py failed: ${syncResult.stderr.trim()}`));
        }

        // Build meta PR
        const branchName = `feat/register-${slug}`;
        const refData = await githubFetch<GitRef>(
          `/repos/${META_OWNER}/${META_REPO}/git/ref/heads/main`,
        );
        await githubWrite(`/repos/${META_OWNER}/${META_REPO}/git/refs`, "POST", {
          ref: `refs/heads/${branchName}`,
          sha: refData.object.sha,
        });

        const syncFiles = ["registry.json", "README.md", "CLAUDE.md", "docs/index.html"];
        for (const filePath of syncFiles) {
          let content: string;
          try {
            content = readFileSync(join(meta, filePath), "utf-8");
          } catch {
            continue;
          }
          let fileSha: string | undefined;
          try {
            const fd = await githubFetch<FileContents>(
              `/repos/${META_OWNER}/${META_REPO}/contents/${filePath}`,
            );
            fileSha = fd.sha;
          } catch {
            // New file
          }
          const body: Record<string, unknown> = {
            message: `feat: register ${slug} [skip ci]`,
            content: Buffer.from(content, "utf-8").toString("base64"),
            branch: branchName,
          };
          if (fileSha) body.sha = fileSha;
          await githubWrite(
            `/repos/${META_OWNER}/${META_REPO}/contents/${filePath}`,
            "PUT",
            body,
          );
        }

        const pr = await githubWrite<PullRequest>(`/repos/${META_OWNER}/${META_REPO}/pulls`, "POST", {
          title: `feat: register ${name} (${slug})`,
          body: `Register new tool repo ${META_OWNER}/${slug} via devtools_createTool.`,
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
          // Best-effort
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  apply: true,
                  slug,
                  repo: `${META_OWNER}/${slug}`,
                  metaPrMerged: pr.number,
                  standardsVersion,
                  status: "created",
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
