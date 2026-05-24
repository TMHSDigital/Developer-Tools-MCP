# Changelog

All notable changes to Developer Tools MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- `devtools_restampRepo`: dry-run or apply standards-version restamp across fleet repos. Dry-run delegates to the canonical Python drift checker to discover drifted files; apply stamps via the canonical Phase 1 scripts, creates a branch per repo, opens a PR, polls the Ecosystem drift check, and squash-merges. Requires `DEVTOOLS_META_ROOT` and `GH_TOKEN`.
- `githubWrite<T>` utility in `src/utils/github.ts` for token-gated POST/PUT/PATCH/DELETE calls to the GitHub REST API.

## [0.1.0] - 2026-05-24

### Added

- Initial scaffold at standards-version 1.10.0
- Four read-only MCP tools: `devtools_getRegistry`, `devtools_getFleetStatus`, `devtools_checkDrift`, `devtools_inspectRepo`
- GitHub REST API default mode with 5-minute in-memory cache; no token required for public repos
- Optional local mode via `DEVTOOLS_META_ROOT` env var for offline meta-repo reads
- `devtools_checkDrift` fetches drift policy from `standards/drift-checker.config.json` at runtime
- CI workflows: `ci.yml` (build and test, Node 20 and 22), `drift-check.yml`, `stale.yml`, `publish.yml`
- Tests for all four tools and utility layer, wired into CI via `npm test`
