# Political Comms SDK - Contributor Notes

This repo holds the official Political Comms client packages:

- `packages/sdk` - TypeScript SDK (`@political-comms/sdk`, npm)
- `packages/cli` - CLI (`@political-comms/cli`, npm)
- `packages/mcp` - MCP server (`@political-comms/mcp`, npm)
- `python/` - Python SDK (`political-comms`, PyPI)

The public API contract every package wraps is the OpenAPI spec published at
https://docs.politicalcomms.com/api-reference/openapi.json (also served at
https://politicalcomms.com/openapi.json). When the spec changes, every package here
changes with it: types, methods, docs, and a version bump on each affected package.

## Conventions

- Email endpoints (`/v1/email/*`) are keyset paginated (`{ data, has_more, next_cursor }`);
  the messaging endpoints return plain arrays. Keep the two shapes distinct in types and docs.
- The MCP server exposes reads, the campaign lifecycle, and the writes that spend money or
  add contacts behind `confirm: true`. It exposes no delete tools; the server test asserts
  the "no destructive operations" property, so keep it that way.
- The CLI depends on the SDK by caret range; bump the CLI only when its own surface changes.

## Build and test

```bash
npm install
npm run build
npm test --workspaces --if-present
cd python && python -m pytest
```
