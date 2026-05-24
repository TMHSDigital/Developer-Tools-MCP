<!-- standards-version: 1.10.0 -->

# Roadmap

**Current:** v0.1.0

## v0.1.0 - Read-Only Core (shipped)

- Four read tools: `devtools_getRegistry`, `devtools_getFleetStatus`, `devtools_checkDrift`, `devtools_inspectRepo`
- GitHub REST API default mode, optional local mode via `DEVTOOLS_META_ROOT`
- `devtools_checkDrift` reads drift policy from the meta-repo at runtime
- Tests for all tools wired into CI

## v0.2.0 - Write Surface (in progress)

Token-gated tools that default to dry-run. Requires `DEVTOOLS_META_ROOT` (local meta-repo clone) and `GH_TOKEN`.

**Shipped:**

| Tool | Description |
|------|-------------|
| `devtools_restampRepo` | Discover and apply standards-version restamps. Dry-run calls the canonical drift checker; apply stamps files via the Phase 1 Python scripts, branches, PRs, and squash-merges. |

**Planned:**

| Tool (planned) | Description |
|----------------|-------------|
| `devtools_createTool` | Invoke the scaffold generator to produce a new tool repo from a name, description, and type. Requires a GitHub token with repo-creation scope. Dry-run by default. |
| `devtools_syncRegistry` | Run the equivalent of `sync_from_registry.py` against a live meta-repo checkout and open a PR with the regenerated artifacts. Requires a token with push scope on the meta-repo. Dry-run by default. |
| `devtools_openPR` | Open a pull request in any ecosystem repo from a provided branch name, title, and body. Requires a token with pull-request scope. Dry-run by default. |

## v1.0.0 - Stable

- Full tool coverage for read and write surfaces
- npm publish under `@tmhs/devtools-mcp`
- Complete documentation and marketplace listing
