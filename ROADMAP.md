<!-- standards-version: 1.10.0 -->

# Roadmap

**Current:** v0.2.0

## v0.1.0 - Read-Only Core (shipped)

- Four read tools: `devtools_getRegistry`, `devtools_getFleetStatus`, `devtools_checkDrift`, `devtools_inspectRepo`
- GitHub REST API default mode, optional local mode via `DEVTOOLS_META_ROOT`
- `devtools_checkDrift` reads drift policy from the meta-repo at runtime
- Tests for all tools wired into CI

## v0.2.0 - Write Surface (COMPLETE)

Token-gated tools that default to dry-run. All require `DEVTOOLS_META_ROOT` (local meta-repo clone) and `GH_TOKEN`.

| Tool | Status | Description |
|------|--------|-------------|
| `devtools_restampRepo` | Shipped | Discover and apply standards-version restamps. Dry-run calls canonical drift checker; apply stamps files via Phase 1 Python scripts, branches, PRs, and squash-merges. |
| `devtools_syncRegistry` | Shipped | Preview or apply `registry.json` field edits and regenerate derived artifacts. Update-only boundary; opens meta-repo PR on apply. |
| `devtools_createTool` | Shipped | Plan or execute a new ecosystem tool repo. Dry-run proves scaffold and reports the full plan. Apply creates a real public repo (confirm-gated), bootstraps, protects, and registers it. |

The write surface is complete. v0.2.0 ships these three tools alongside the four read tools from v0.1.0.

## v1.0.0 - Stable

- Full tool coverage for read and write surfaces
- npm publish under `@tmhs/devtools-mcp`
- Complete documentation and marketplace listing
