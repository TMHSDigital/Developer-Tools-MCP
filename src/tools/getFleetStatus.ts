import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  fetchStandardsVersion,
  rawFetch,
  githubFetch,
  extractStandardsVersion,
  errorResponse,
} from "../utils/github.js";

const inputSchema = {
  include_standards_version: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, fetch each repo's CLAUDE.md to include its standards-version signal. Adds one API call per repo.",
    ),
};

type ReleaseInfo = { tag_name: string } | null;

function versionSignal(
  repoVersion: string,
  latestTag: string | null,
): "current" | "behind" | "ahead" | "no-release" {
  if (!latestTag) return "no-release";
  const tag = latestTag.replace(/^v/, "");
  if (tag === repoVersion) return "current";
  const parse = (v: string): [number, number, number] => {
    const p = v.split(".").map(Number);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  };
  const [rm, rn, rp] = parse(repoVersion);
  const [tm, tn, tp] = parse(tag);
  if (rm > tm || (rm === tm && rn > tn) || (rm === tm && rn === tn && rp > tp))
    return "ahead";
  return "behind";
}

export function register(server: McpServer): void {
  server.tool(
    "devtools_getFleetStatus",
    "List all tool repos in the ecosystem with their registry version, latest GitHub release tag, and a current/behind/ahead signal. Optionally include the standards-version from each repo's CLAUDE.md.",
    inputSchema,
    async ({ include_standards_version }) => {
      try {
        const [registry, metaStandardsVersion] = await Promise.all([
          fetchRegistry(),
          fetchStandardsVersion(),
        ]);

        const results = await Promise.all(
          registry.map(async (entry) => {
            const [owner, repo] = entry.repo.split("/");
            let latestTag: string | null = null;
            try {
              const release = await githubFetch<ReleaseInfo>(
                `/repos/${owner}/${repo}/releases/latest`,
              );
              latestTag = release?.tag_name ?? null;
            } catch {
              // No release published yet
            }

            let standardsVersion: string | null = null;
            if (include_standards_version) {
              try {
                const claudeMd = await rawFetch(owner, repo, "CLAUDE.md");
                standardsVersion = extractStandardsVersion(claudeMd);
              } catch {
                // Agent file missing or inaccessible
              }
            }

            return {
              slug: entry.slug,
              name: entry.name,
              type: entry.type,
              status: entry.status,
              registryVersion: entry.version,
              latestReleaseTag: latestTag,
              versionSignal: versionSignal(entry.version, latestTag),
              ...(include_standards_version
                ? { standardsVersion, metaStandardsVersion }
                : {}),
            };
          }),
        );

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
