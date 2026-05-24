import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubError, RateLimitError, NotFoundError } from "../errors.js";

// Validate error class hierarchy and messages

describe("GitHubError", () => {
  it("stores statusCode and endpoint", () => {
    const err = new GitHubError("bad request", 400, "/repos/foo");
    expect(err.statusCode).toBe(400);
    expect(err.endpoint).toBe("/repos/foo");
    expect(err.name).toBe("GitHubError");
  });
});

describe("NotFoundError", () => {
  it("sets status 404 and includes resource in message", () => {
    const err = new NotFoundError("TMHSDigital/steam-mcp");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("TMHSDigital/steam-mcp");
    expect(err instanceof GitHubError).toBe(true);
  });
});

describe("RateLimitError", () => {
  it("sets status 429 and mentions GH_TOKEN", () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain("GH_TOKEN");
    expect(err instanceof GitHubError).toBe(true);
  });
});

// Validate schema helpers

describe("extractStandardsVersion", () => {
  it("extracts version from HTML comment", async () => {
    const { extractStandardsVersion } = await import("../github.js");
    expect(
      extractStandardsVersion("<!-- standards-version: 1.10.0 -->\n# CLAUDE.md"),
    ).toBe("1.10.0");
  });

  it("returns null when marker is absent", async () => {
    const { extractStandardsVersion } = await import("../github.js");
    expect(extractStandardsVersion("# CLAUDE.md\nNo marker here.")).toBeNull();
  });

  it("tolerates extra whitespace in comment", async () => {
    const { extractStandardsVersion } = await import("../github.js");
    expect(
      extractStandardsVersion("<!--  standards-version:  1.9.5  -->"),
    ).toBe("1.9.5");
  });
});

// Validate fetch error mapping

describe("githubFetch error mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws NotFoundError on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
    const { githubFetch } = await import("../github.js");
    await expect(githubFetch("/repos/x/y")).rejects.toThrow(NotFoundError);
    vi.unstubAllGlobals();
  });

  it("throws RateLimitError on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }),
    );
    const { githubFetch } = await import("../github.js");
    await expect(githubFetch("/repos/x/y")).rejects.toThrow(RateLimitError);
    vi.unstubAllGlobals();
  });
});
