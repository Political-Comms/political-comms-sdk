# Political Comms SDK - Agent Instructions

This repo holds the official Political Comms client packages:

- `packages/sdk` - TypeScript SDK (`@political-comms/sdk`, npm)
- `packages/cli` - CLI (`@political-comms/cli`, npm)
- `packages/mcp` - MCP server (`@political-comms/mcp`, npm)
- `python/` - Python SDK (`political-comms`, PyPI)

The public API surface these clients wrap is defined by the OpenAPI spec maintained in the `political-comms-docs` sibling repo (`api-reference/openapi.json`). When the API changes in `political-comms-app`, every package here must be updated to match - types, methods, docs, and version bumps. Publishing to npm/PyPI is owner-executed; prepare the release, don't push it.

## Cross-layer standard

This repo is one of six layers of the Political Comms platform (app frontend/backend, public docs, marketing site, pccampaigns-site, this SDK repo, agents repo). Every task ends with a surface sweep: changes elsewhere (especially the public API) must land here, and SDK changes may ripple to docs and the agents repo. The canonical rule and ripple-chain table live in `../political-comms-app/AGENTS.md`, section "Cross-Layer Surface Sweep". Working across all sibling repos is standing policy - don't ask per-repo.
