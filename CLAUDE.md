<!-- standards-version: 1.10.0 -->

# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project

Developer Tools MCP -- MCP server exposing the TMHSDigital developer-tools ecosystem as agent-callable read tools

**Version:** 0.1.0
**License:** CC-BY-NC-ND-4.0
**Author:** TMHSDigital

## Key paths

- Source: `src/`
- Package manifest: `package.json`
- Docs site: `docs/`
- CI workflows: `.github/workflows/`

## Conventions

- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- Never manually edit the version in package.json -- CI handles it
- All skills need YAML frontmatter with title, description, globs
- All rules need frontmatter with description, globs, alwaysApply

## Testing

```bash
cd mcp-server && pip install -r requirements.txt
python3 -m py_compile server.py
```
