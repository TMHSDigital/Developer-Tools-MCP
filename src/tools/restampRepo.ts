import { z } from "zod";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  fetchStandardsVersion,
  githubFetch,
  githubWrite,
  errorResponse,
} from "../utils/github.js";

const PYTHON = process.platform === "win32" ? "python" : "python3";

interface CliFinding {
  repo: string;
  file: string | null;
  check: string;
  severity: string;
  message: string;
  suggested_fix: string | null;
}

interface CliJsonOutput {
  meta_version: string;
  checked_at: string;
  repos: Array<{
    slug: string;
    repo_type: string;
    files_checked: number;
    findings: CliFinding[];
  }>;
  summary: { errors: number; warnings: number; infos: number };
}

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

function spawnCli(args: string[], meta: string): { stdout: string; stderr: string; code: number } {
  const cliPath = join(meta, "scripts", "drift_check", "cli.py");
  const result = spawnSync(PYTHON, [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 120_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 2,
  };
}

function parseCli(stdout: string): CliJsonOutput {
  return JSON.parse(stdout) as CliJsonOutput;
}

function versionSignalFindings(output: CliJsonOutput): Array<{ slug: string; repo: string; files: string[] }> {
  return output.repos
    .map((r) => ({
      slug: r.slug,
      repo: r.slug,
      files: r.findings
        .filter((f) => f.check === "version-signal" && f.file !== null)
        .map((f) => f.file as string),
    }))
    .filter((r) => r.files.length > 0);
}

async function applyTransform(tmpFile: string, version: string, meta: string): Promise<boolean> {
  const scriptsDir = join(meta, "scripts");
  for (const script of ["add_frontmatter.py", "add_comment_marker.py"]) {
    const result = spawnSync(PYTHON, [join(scriptsDir, script), tmpFile, version], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (result.status === 0) return true;
  }
  return false;
}

async function stampRepo(
  ownerRepo: string,
  files: string[],
  targetVersion: string,
  meta: string,
): Promise<{ branchName: string; prNumber: number } | null> {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) return null;

  const branchName = `chore/restamp-standards-v${targetVersion}`;

  const refData = await githubFetch<GitRef>(`/repos/${owner}/${repo}/git/ref/heads/main`);
  const headSha = refData.object.sha;

  await githubWrite(`/repos/${owner}/${repo}/git/refs`, "POST", {
    ref: `refs/heads/${branchName}`,
    sha: headSha,
  });

  let stamped = 0;
  for (const filePath of files) {
    let fileData: FileContents;
    try {
      fileData = await githubFetch<FileContents>(
        `/repos/${owner}/${repo}/contents/${filePath}`,
      );
    } catch {
      continue;
    }

    const rawContent = Buffer.from(fileData.content.replace(/\n/g, ""), "base64").toString("utf-8");

    const tmpDir = mkdtempSync(join(tmpdir(), "devtools-"));
    try {
      const tmpFile = join(tmpDir, "file.tmp");
      writeFileSync(tmpFile, rawContent, "utf-8");

      const ok = await applyTransform(tmpFile, targetVersion, meta);
      if (!ok) continue;

      const newContent = readFileSync(tmpFile, "utf-8");
      const encoded = Buffer.from(newContent, "utf-8").toString("base64");

      await githubWrite(`/repos/${owner}/${repo}/contents/${filePath}`, "PUT", {
        message: `chore: restamp standards-version to ${targetVersion} in ${filePath} [skip ci]`,
        content: encoded,
        sha: fileData.sha,
        branch: branchName,
      });
      stamped++;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (stamped === 0) {
    await githubWrite(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, "DELETE");
    return null;
  }

  const pr = await githubWrite<PullRequest>(`/repos/${owner}/${repo}/pulls`, "POST", {
    title: `chore: restamp standards-version to ${targetVersion} [skip ci]`,
    body: `Automated standards-version restamp to ${targetVersion} via devtools_restampRepo.`,
    head: branchName,
    base: "main",
  });

  return { branchName, prNumber: pr.number };
}

async function waitAndMerge(
  ownerRepo: string,
  prNumber: number,
  branchName: string,
  prHeadSha: string,
): Promise<void> {
  const [owner, repo] = ownerRepo.split("/");
  const checkPath = `/repos/${owner}/${repo}/commits/${prHeadSha}/check-runs`;

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const data = await githubFetch<CheckRuns>(checkPath);
      const drift = data.check_runs.find((c) => c.name === "Ecosystem drift check");
      if (!drift || drift.status !== "completed") continue;
      if (drift.conclusion === "success") break;
      if (drift.conclusion === "failure" || drift.conclusion === "action_required") {
        throw new Error(`Drift check failed on PR #${prNumber} for ${ownerRepo}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Drift check failed")) throw e;
    }
  }

  await githubWrite(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, "PUT", {
    merge_method: "squash",
  });

  try {
    await githubWrite(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, "DELETE");
  } catch {
    // Best-effort cleanup
  }
}

const inputSchema = {
  slug: z
    .string()
    .optional()
    .describe(
      "Registry slug of a single repo to restamp. Omit to restamp all registered repos.",
    ),
  version: z
    .string()
    .optional()
    .describe(
      "Target standards-version. Defaults to the canonical meta STANDARDS_VERSION. " +
        "Must match the meta STANDARDS_VERSION; update that file first to stamp ahead.",
    ),
  apply: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true to create branches, commit stamps, open PRs, and squash-merge. " +
        "Dry-run by default (apply=false). Requires GH_TOKEN and DEVTOOLS_META_ROOT.",
    ),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_restampRepo",
    "Preview or apply a standards-version restamp across ecosystem repos. " +
      "Dry-run (default) calls the canonical drift checker to show which files are out of date. " +
      "Apply mode creates a branch per repo, stamps the files via the canonical Python scripts, " +
      "opens a PR, waits for the Ecosystem drift check, and squash-merges. " +
      "Requires DEVTOOLS_META_ROOT (path to local meta-repo clone) for both modes. " +
      "Requires GH_TOKEN or GITHUB_TOKEN for apply mode and for fetching remote repos.",
    inputSchema,
    async ({ slug, version, apply }) => {
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

        const ghToken = token();
        if (!ghToken) {
          return errorResponse(
            new Error(
              "GH_TOKEN or GITHUB_TOKEN is not set. " +
                "A token is required to call the drift checker against remote repos.",
            ),
          );
        }

        const metaVersion = await fetchStandardsVersion();
        const targetVersion = version ?? metaVersion;

        if (targetVersion !== metaVersion) {
          return errorResponse(
            new Error(
              `Requested version ${targetVersion} does not match meta STANDARDS_VERSION ${metaVersion}. ` +
                "Update STANDARDS_VERSION in the meta-repo first, then restamp.",
            ),
          );
        }

        // Discover which repos and files need stamping via the canonical drift checker
        const registry = await fetchRegistry();
        const targets = slug
          ? registry.filter((e) => e.slug === slug)
          : registry.filter((e) => e.status === "active");

        if (slug && targets.length === 0) {
          return errorResponse(new Error(`No registry entry found for slug: ${slug}`));
        }

        const cliArgs: string[] = ["--format", "json", "--gh-token", ghToken, "--meta-repo", meta];
        if (slug && targets[0]) {
          cliArgs.push("--remote", targets[0].repo);
        } else {
          cliArgs.push("--all");
        }

        const { stdout, stderr, code } = spawnCli(cliArgs, meta);
        if (code === 2) {
          return errorResponse(
            new Error(`Drift checker failed (exit 2): ${stderr.trim() || "no stderr"}`),
          );
        }
        if (!stdout.trim()) {
          return errorResponse(new Error("Drift checker produced no output."));
        }

        let cliOutput: CliJsonOutput;
        try {
          cliOutput = parseCli(stdout);
        } catch {
          return errorResponse(new Error(`Failed to parse drift checker JSON: ${stdout.slice(0, 200)}`));
        }

        const reposWithDrift = versionSignalFindings(cliOutput);

        if (!apply) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    targetVersion,
                    apply: false,
                    checkedRepos: cliOutput.repos.length,
                    reposNeedingRestamp: reposWithDrift.length,
                    plannedChanges: reposWithDrift,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Apply mode: stamp each repo
        const results: Array<{
          repo: string;
          status: "stamped" | "skipped" | "error";
          prNumber?: number;
          error?: string;
        }> = [];

        for (const entry of reposWithDrift) {
          const registryEntry = targets.find((r) => r.slug === entry.slug);
          if (!registryEntry) continue;

          try {
            const pr = await stampRepo(registryEntry.repo, entry.files, targetVersion, meta);
            if (!pr) {
              results.push({ repo: registryEntry.repo, status: "skipped" });
              continue;
            }

            const prData = await githubFetch<PullRequest>(
              `/repos/${registryEntry.repo}/pulls/${pr.prNumber}`,
            );

            await waitAndMerge(
              registryEntry.repo,
              pr.prNumber,
              pr.branchName,
              prData.head.sha,
            );

            results.push({
              repo: registryEntry.repo,
              status: "stamped",
              prNumber: pr.prNumber,
            });
          } catch (e) {
            results.push({
              repo: registryEntry.repo,
              status: "error",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  targetVersion,
                  apply: true,
                  results,
                  stamped: results.filter((r) => r.status === "stamped").length,
                  skipped: results.filter((r) => r.status === "skipped").length,
                  errors: results.filter((r) => r.status === "error").length,
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
