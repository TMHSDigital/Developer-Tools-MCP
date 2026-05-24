# Developer Tools MCP

MCP server exposing the TMHSDigital developer-tools ecosystem as agent-callable read tools.

![License: CC-BY-NC-ND-4.0](https://img.shields.io/badge/license-CC--BY--NC--ND--4.0-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

**v0.2.0 adds a write surface.** Three write tools ship alongside the four read tools. All write tools default to dry-run and require `DEVTOOLS_META_ROOT` and `GH_TOKEN`. The write surface is now complete; see [ROADMAP.md](ROADMAP.md).

---

## What it does

### Read tools (no token needed for public repos)

| Tool | Description |
|------|-------------|
| `devtools_getRegistry` | Return entries from `registry.json`, with optional filtering by type, status, or slug |
| `devtools_getFleetStatus` | List all repos with registry version, latest release tag, and current/behind/ahead signal |
| `devtools_checkDrift` | Return drift findings: standards-version mismatches and missing required workflows |
| `devtools_inspectRepo` | Detailed view of one repo: GitHub metadata, open PRs, CI run status, standards-version |

`devtools_checkDrift` fetches `standards/drift-checker.config.json` from the meta-repo at runtime. The canonical drift checker (`scripts/drift_check/cli.py`) is authoritative; this tool is a convenience reader for agents that cannot run Python locally.

### Write tools (dry-run by default; require `DEVTOOLS_META_ROOT` and `GH_TOKEN`)

| Tool | Description |
|------|-------------|
| `devtools_restampRepo` | Preview or apply a standards-version restamp across fleet repos. Dry-run calls the canonical drift checker to discover drifted files; apply stamps via the Phase 1 Python scripts, branches, PRs, and squash-merges. |
| `devtools_syncRegistry` | Preview or apply `registry.json` field edits and regenerate derived artifacts (README, CLAUDE.md, docs/index.html). Update-only: rejects slugs not in `registry.json`. Apply runs `sync_from_registry.py`, verifies with `--check`, and opens a meta-repo PR. |
| `devtools_createTool` | Plan or execute creation of a new ecosystem tool repo. Dry-run validates inputs, runs `scaffold/create-tool.py` to a temp dir, lists generated files, and reports the would-be registry entry and `STANDARDS_VERSION`. Apply creates a real public GitHub repo (IRREVERSIBLE; requires `confirm=true` and a token with repo-creation scope), scaffolds and bootstraps it, applies branch protection, and registers it via a meta-repo PR. |

**Boundary rule:** `devtools_syncRegistry` only updates existing entries. `devtools_createTool` is the only tool that can add a new entry.

**createTool apply guard:** Setting `apply=true` without `confirm=true` is refused. The `gh repo create` step creates a live public repo and cannot be undone.

---

## Running as an MCP server

### Quick start with npx

```bash
GH_TOKEN=your_token npx @tmhs/devtools-mcp
```

### From source

```bash
git clone https://github.com/TMHSDigital/Developer-Tools-MCP.git
cd Developer-Tools-MCP
npm install
npm run build
GH_TOKEN=your_token node dist/index.js
```

### Claude Desktop / Cursor config

Add to your MCP client config:

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["@tmhs/devtools-mcp"],
      "env": {
        "GH_TOKEN": "your_token_here"
      }
    }
  }
}
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GH_TOKEN` | Strongly recommended | GitHub personal access token. No scopes required for public repos. Without it, GitHub limits unauthenticated requests to 60 per hour per IP. A single full fleet call fans out to 20-30 requests. |
| `GITHUB_TOKEN` | Alternative | Accepted as a fallback if `GH_TOKEN` is not set. |
| `DEVTOOLS_META_ROOT` | Required for write tools | Absolute path to a local `Developer-Tools-Directory` checkout. When set, `registry.json`, `VERSION`, and the drift config are read from disk instead of GitHub. Required for all write tools (`restampRepo`, `syncRegistry`, `createTool`). |

Copy `.env.example` to `.env` and fill in `GH_TOKEN` before running locally.

---

## Caching

All GitHub API and raw file responses are cached in memory with a 5-minute TTL. Repeated tool calls within a session reuse cached data without additional API requests.

---

## Public safety posture

- Write tools default to dry-run (`apply=false`). No network mutations without explicit opt-in.
- `createTool apply` requires both `apply=true` AND `confirm=true` plus a token with repo-creation scope.
- No secrets are committed. Tokens come from environment variables only.
- No hardcoded paths. All GitHub reads use the public API or raw content URLs.
- Rate-limit errors name `GH_TOKEN` and link to how to get one.

---

## Development

```bash
npm install
npm run build
npm test
```

Tests use vitest with mocked fetch responses. No live API calls are made in CI.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

CC-BY-NC-ND-4.0 - see [LICENSE](LICENSE) for details.
