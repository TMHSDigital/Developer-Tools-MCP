import { GitHubError, NotFoundError, RateLimitError } from "./errors.js";

const META_OWNER = "TMHSDigital";
const META_REPO = "Developer-Tools-Directory";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  return undefined;
}

function store<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function buildHeaders(): Record<string, string> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "devtools-mcp/0.1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function githubFetch<T>(path: string): Promise<T> {
  const hit = cached<T>(`api:${path}`);
  if (hit !== undefined) return hit;

  const url = `https://api.github.com${path}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (res.status === 404) throw new NotFoundError(path);
  if (res.status === 403 || res.status === 429) throw new RateLimitError();
  if (!res.ok) {
    throw new GitHubError(`GitHub API ${res.status} for ${path}`, res.status, path);
  }

  const data = (await res.json()) as T;
  store(`api:${path}`, data);
  return data;
}

export async function rawFetch(
  owner: string,
  repo: string,
  filePath: string,
  ref = "main",
): Promise<string> {
  const key = `raw:${owner}/${repo}/${ref}/${filePath}`;
  const hit = cached<string>(key);
  if (hit !== undefined) return hit;

  // Local mode: if DEVTOOLS_META_ROOT is set and this is the meta-repo, read from disk.
  const metaRoot = process.env.DEVTOOLS_META_ROOT;
  if (metaRoot && owner === META_OWNER && repo === META_REPO) {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const text = await readFile(join(metaRoot, filePath), "utf-8");
    store(key, text);
    return text;
  }

  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (res.status === 404) throw new NotFoundError(`${owner}/${repo}/${filePath}`);
  if (res.status === 403 || res.status === 429) throw new RateLimitError();
  if (!res.ok) {
    throw new GitHubError(
      `Raw fetch ${res.status} for ${owner}/${repo}/${filePath}`,
      res.status,
    );
  }

  const text = await res.text();
  store(key, text);
  return text;
}

export function errorResponse(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message =
    error instanceof Error ? error.message : "An unknown error occurred.";
  return { content: [{ type: "text", text: message }], isError: true };
}

export function extractStandardsVersion(content: string): string | null {
  const match = content.match(/<!--\s*standards-version:\s*([\d.]+)\s*-->/);
  return match?.[1] ?? null;
}

export type RegistryEntry = {
  name: string;
  repo: string;
  slug: string;
  description: string;
  type: "cursor-plugin" | "mcp-server";
  homepage: string;
  skills: number;
  rules: number;
  mcpTools: number;
  extras: Record<string, unknown>;
  topics: string[];
  status: string;
  version: string;
  language: string;
  license: string;
  pagesType: string;
  hasCI: boolean;
  npm?: string;
};

export async function fetchRegistry(): Promise<RegistryEntry[]> {
  const raw = await rawFetch(META_OWNER, META_REPO, "registry.json");
  return JSON.parse(raw) as RegistryEntry[];
}

export async function fetchMetaVersion(): Promise<string> {
  const raw = await rawFetch(META_OWNER, META_REPO, "VERSION");
  return raw.trim();
}
