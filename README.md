# Developer Tools MCP

MCP server exposing the TMHSDigital developer-tools ecosystem as agent-callable read tools.

![License: CC-BY-NC-ND-4.0](https://img.shields.io/badge/license-CC--BY--NC--ND--4.0-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

**v1 is read-only.** No write operations, no secrets, no tokens committed. The write roadmap is documented in [ROADMAP.md](ROADMAP.md).

---

## What it does

This server gives any MCP-capable agent four read tools against the ecosystem:

| Tool | Description |
|------|-------------|
| `devtools_getRegistry` | Return entries from `registry.json`, with optional filtering by type, status, or slug |
| `devtools_getFleetStatus` | List all repos with registry version, latest release tag, and current/behind/ahead signal |
| `devtools_checkDrift` | Return drift findings: standards-version mismatches and missing required workflows |
| `devtools_inspectRepo` | Detailed view of one repo: GitHub metadata, open PRs, CI run status, standards-version |

`devtools_checkDrift` fetches `standards/drift-checker.config.json` from the meta-repo at runtime and applies its thresholds and required-workflow lists. The canonical drift checker (`scripts/drift_check/cli.py` in the meta-repo) is authoritative; this tool is a convenience reader for agents that cannot run Python locally.

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
| `DEVTOOLS_META_ROOT` | Optional | Absolute path to a local `Developer-Tools-Directory` checkout. When set, `registry.json`, `VERSION`, and the drift config are read from disk instead of GitHub. Useful for offline operation. |

Copy `.env.example` to `.env` and fill in `GH_TOKEN` before running locally.

---

## Caching

All GitHub API and raw file responses are cached in memory with a 5-minute TTL. Repeated tool calls within a session reuse cached data without additional API requests.

---

## Public safety posture

- Read-only. No tool modifies any repo, file, or GitHub resource.
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
