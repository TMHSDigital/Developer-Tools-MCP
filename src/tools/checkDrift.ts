import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  fetchMetaVersion,
  rawFetch,
  githubFetch,
  extractStandardsVersion,
  errorResponse,
} from "../utils/github.js";

interface DriftConfig {
  version: number;
  globals: {
    signal_policy: string;
    skip_checks: string[];
  };
  types: Record<
    string,
    { skip_checks: string[]; required_workflows: string[] }
  >;
  repos: Record<string, { skip_checks: string[] }>;
}

type Severity = "ok" | "error" | "warn" | "info";

function parseSemver(v: string): [number, number, number] {
  const parts = v
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function applySignalPolicy(
  policy: string,
  repoVersion: string,
  metaVersion: string,
): Severity {
  const [rm, rn, rp] = parseSemver(repoVersion);
  const [mm, mn, mp] = parseSemver(metaVersion);

  // Repo is ahead of meta - unexpected, surface as warning
  if (
    rm > mm ||
    (rm === mm && rn > mn) ||
    (rm === mm && rn === mn && rp > mp)
  ) {
    return "warn";
  }

  if (policy === "same-major-minor") {
    if (rm !== mm || rn !== mn) return "error";
    if (rp !== mp) return "info";
    return "ok";
  }

  // Fallback: any mismatch is an error
  if (rm !== mm || rn !== mn || rp !== mp) return "error";
  return "ok";
}

type WorkflowFile = { name: string; type: string };

async function fetchWorkflowNames(owner: string, repo: string): Promise<string[]> {
  try {
    const files = await githubFetch<WorkflowFile[]>(
      `/repos/${owner}/${repo}/contents/.github/workflows`,
    );
    return files.filter((f) => f.type === "file").map((f) => f.name);
  } catch {
    return [];
  }
}

const inputSchema = {
  slug: z
    .string()
    .optional()
    .describe("Check only the repo with this registry slug. Omit to check the full fleet."),
  verbose: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include info-severity findings (patch-only version differences). Errors and warnings are always included."),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_checkDrift",
    "Return drift findings across the ecosystem fleet: standards-version mismatches and missing required workflows. Drift policy is read from the meta-repo's standards/drift-checker.config.json at runtime - the canonical drift checker is always authoritative; this tool is a convenience reader.",
    inputSchema,
    async ({ slug, verbose }) => {
      try {
        const [configRaw, registry, metaVersion] = await Promise.all([
          rawFetch(
            "TMHSDigital",
            "Developer-Tools-Directory",
            "standards/drift-checker.config.json",
          ),
          fetchRegistry(),
          fetchMetaVersion(),
        ]);

        const config = JSON.parse(configRaw) as DriftConfig;
        const policy = config.globals?.signal_policy ?? "same-major-minor";

        const targets = slug
          ? registry.filter((e) => e.slug === slug)
          : registry;

        if (slug && targets.length === 0) {
          return errorResponse(new Error(`No registry entry found for slug: ${slug}`));
        }

        const findings = await Promise.all(
          targets.map(async (entry) => {
            const [owner, repo] = entry.repo.split("/");
            const repoConfig = config.repos?.[entry.slug];
            const typeConfig = config.types?.[entry.type];
            const skipChecks = [
              ...(config.globals?.skip_checks ?? []),
              ...(typeConfig?.skip_checks ?? []),
              ...(repoConfig?.skip_checks ?? []),
            ];
            const requiredWorkflows = typeConfig?.required_workflows ?? [];

            const repoFindings: Array<{
              check: string;
              severity: Severity;
              message: string;
            }> = [];

            // Version signal check
            if (!skipChecks.includes("version-signal")) {
              let standardsVersion: string | null = null;
              try {
                const claudeMd = await rawFetch(owner, repo, "CLAUDE.md");
                standardsVersion = extractStandardsVersion(claudeMd);
              } catch {
                // Try AGENTS.md as fallback
                try {
                  const agentsMd = await rawFetch(owner, repo, "AGENTS.md");
                  standardsVersion = extractStandardsVersion(agentsMd);
                } catch {
                  // Agent files not accessible
                }
              }

              if (standardsVersion === null) {
                repoFindings.push({
                  check: "version-signal",
                  severity: "warn",
                  message: "standards-version marker not found in CLAUDE.md or AGENTS.md",
                });
              } else {
                const severity = applySignalPolicy(policy, standardsVersion, metaVersion);
                if (severity !== "ok") {
                  repoFindings.push({
                    check: "version-signal",
                    severity,
                    message: `standards-version ${standardsVersion} vs meta ${metaVersion}`,
                  });
                }
              }
            }

            // Required workflows check
            if (!skipChecks.includes("required-workflows") && requiredWorkflows.length > 0) {
              const present = await fetchWorkflowNames(owner, repo);
              for (const wf of requiredWorkflows) {
                if (!present.includes(wf)) {
                  repoFindings.push({
                    check: "required-workflows",
                    severity: "error",
                    message: `required workflow missing: ${wf}`,
                  });
                }
              }
            }

            return { slug: entry.slug, repo: entry.repo, findings: repoFindings };
          }),
        );

        const filtered = findings.map((r) => ({
          ...r,
          findings: r.findings.filter(
            (f) => verbose || f.severity !== "info",
          ),
        }));

        const summary = {
          metaVersion,
          signalPolicy: policy,
          checkedRepos: filtered.length,
          errors: filtered.flatMap((r) =>
            r.findings.filter((f) => f.severity === "error"),
          ).length,
          warnings: filtered.flatMap((r) =>
            r.findings.filter((f) => f.severity === "warn"),
          ).length,
          results: filtered,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
