import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchRegistry,
  rawFetch,
  githubFetch,
  extractStandardsVersion,
  errorResponse,
} from "../utils/github.js";

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  open_issues_count: number;
  default_branch: string;
  pushed_at: string;
  topics: string[];
  license: { spdx_id: string } | null;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
}

interface WorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[];
}

const inputSchema = {
  slug: z
    .string()
    .min(1)
    .describe("Registry slug of the repo to inspect (e.g. steam-mcp, docker-developer-tools)"),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_inspectRepo",
    "Return a detailed view of one ecosystem repo: GitHub metadata, open PR count, latest CI run statuses, and the standards-version from the repo's agent files.",
    inputSchema,
    async ({ slug }) => {
      try {
        const registry = await fetchRegistry();
        const entry = registry.find((e) => e.slug === slug);
        if (!entry) {
          return errorResponse(new Error(`No registry entry found for slug: ${slug}`));
        }

        const [owner, repo] = entry.repo.split("/");

        const [repoInfo, pullsRaw, runsRaw, claudeMdRaw] = await Promise.allSettled([
          githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`),
          githubFetch<PullRequest[]>(
            `/repos/${owner}/${repo}/pulls?state=open&per_page=5`,
          ),
          githubFetch<WorkflowRunsResponse>(
            `/repos/${owner}/${repo}/actions/runs?per_page=5`,
          ),
          rawFetch(owner, repo, "CLAUDE.md"),
        ]);

        const ghRepo =
          repoInfo.status === "fulfilled" ? repoInfo.value : null;
        const openPRs =
          pullsRaw.status === "fulfilled" ? pullsRaw.value : [];
        const runs =
          runsRaw.status === "fulfilled"
            ? runsRaw.value.workflow_runs
            : [];
        const claudeMd =
          claudeMdRaw.status === "fulfilled" ? claudeMdRaw.value : null;

        const standardsVersion = claudeMd
          ? extractStandardsVersion(claudeMd)
          : null;

        const result = {
          slug: entry.slug,
          name: entry.name,
          type: entry.type,
          status: entry.status,
          registryVersion: entry.version,
          language: entry.language,
          license: entry.license,
          mcpTools: entry.mcpTools,
          ...(entry.npm ? { npm: entry.npm } : {}),
          standardsVersion,
          github: ghRepo
            ? {
                htmlUrl: ghRepo.html_url,
                description: ghRepo.description,
                stars: ghRepo.stargazers_count,
                openIssues: ghRepo.open_issues_count,
                lastPush: ghRepo.pushed_at,
                defaultBranch: ghRepo.default_branch,
              }
            : null,
          openPRs: openPRs.map((pr) => ({ number: pr.number, title: pr.title })),
          recentRuns: runs.map((r) => ({
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            createdAt: r.created_at,
            url: r.html_url,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
