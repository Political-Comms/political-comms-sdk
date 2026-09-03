# Political Comms SDK - Agent Instructions

This repo holds the official Political Comms client packages:

- `packages/sdk` - TypeScript SDK (`@political-comms/sdk`, npm)
- `packages/cli` - CLI (`@political-comms/cli`, npm)
- `packages/mcp` - MCP server (`@political-comms/mcp`, npm)
- `python/` - Python SDK (`political-comms`, PyPI)

The public API surface these clients wrap is defined by the OpenAPI spec maintained in the `political-comms-docs` sibling repo (`api-reference/openapi.json`). When the API changes in `political-comms-app`, every package here must be updated to match - types, methods, docs, and version bumps. Publishing to npm/PyPI is owner-executed; prepare the release, don't push it.

## Email surface (early access)

All four packages wrap the 40 `/v1/email` operations (domains, senders, lists,
imports, suppressions, templates, drafts, campaigns) added by DEV-654. Every one of them returns
`403 EMAIL_EARLY_ACCESS` until the email product reaches general availability,
so each method, tool, and command must say so in its docstring or description.
Email lists are keyset paginated (`{ data, has_more, next_cursor }`), unlike the
older messaging endpoints, which return plain arrays. There is no inbound email
or inbox surface, and no A/B testing: do not add methods for either.

The MCP email surface is reads, the campaign lifecycle, and the two writes that
spend money or add contacts (`create_email_template_draft`,
`start_email_list_import`), both behind `confirm: true`. It exposes no delete
tools, which is what keeps the "no destructive operations" property the server
test asserts. Template create, update, and delete stay off the MCP surface:
authoring HTML belongs in a script against the SDK.

## Cross-layer standard

This repo is one of six layers of the Political Comms platform (app frontend/backend, public docs, marketing site, pccampaigns-site, this SDK repo, agents repo). Every task ends with a surface sweep: changes elsewhere (especially the public API) must land here, and SDK changes may ripple to docs and the agents repo. The canonical rule and ripple-chain table live in `../political-comms-app/AGENTS.md`, section "Cross-Layer Surface Sweep". Working across all sibling repos is standing policy - don't ask per-repo.
