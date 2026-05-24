# Changelog

All notable changes to Developer Tools MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.2.0] - 2026-05-24

### Added

- `devtools_restampRepo`: preview or apply a standards-version restamp across fleet repos. Dry-run calls the canonical drift checker (`scripts/drift_check/cli.py`) to discover drifted files. Apply stamps files via Phase 1 Python scripts, opens per-repo branches and PRs, and squash-merges when CI passes. Requires `DEVTOOLS_META_ROOT` and `GH_TOKEN`.
- `devtools_syncRegistry`: preview or apply `registry.json` field edits and regenerate derived artifacts (README.md, CLAUDE.md, docs/index.html). Update-only boundary: rejects slugs not already in the registry. Dry-run runs `sync_from_registry.py --check` against the edited registry without committing. Apply writes edits, regenerates, verifies with `--check`, and opens a meta-repo PR that is squash-merged when CI passes. Requires `DEVTOOLS_META_ROOT` and `GH_TOKEN`.
- `devtools_createTool`: plan or execute creation of a new ecosystem tool repo. Dry-run validates inputs, runs `scaffold/create-tool.py` to a temp dir, lists generated files, reports the would-be registry entry and `STANDARDS_VERSION` at birth. Apply creates a real public GitHub repo (guarded by `confirm=true` and token with repo-creation scope), scaffolds, bootstraps, applies branch protection matching the type, and registers via meta-repo PR. Requires `DEVTOOLS_META_ROOT`.
- `.gitattributes` with `text=auto` and `*.ts eol=lf` to eliminate CRLF phantom changes in git status.
- GitHub Pages documentation site at `docs/index.html` covering all 7 tools, quick start, and environment variable reference.

## [0.1.0] - 2026-05-24

### Added

- Initial scaffold at standards-version 1.10.0
- Four read-only MCP tools: `devtools_getRegistry`, `devtools_getFleetStatus`, `devtools_checkDrift`, `devtools_inspectRepo`
- GitHub REST API default mode with 5-minute in-memory cache; no token required for public repos
- Optional local mode via `DEVTOOLS_META_ROOT` env var for offline meta-repo reads
- `devtools_checkDrift` fetches drift policy from `standards/drift-checker.config.json` at runtime
- CI workflows: `ci.yml` (build and test, Node 20 and 22), `drift-check.yml`, `stale.yml`, `publish.yml`
- Tests for all four tools and utility layer, wired into CI via `npm test`
