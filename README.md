# Political Comms SDK

Official client libraries and tools for the [Political Comms](https://politicalcomms.com/) REST API. Direct-to-carrier political texting for campaigns, PACs, advocacy organizations, fundraisers, and elected officials.

The API surface covers Projects (compose, test, schedule, send), Contact Lists, Media Files, Organizations and hierarchy, Brands, Campaigns, Tracking Domains, Phone Numbers, Analytics, Billing, and Email (early access: sending domains, sender identities, lists and imports, suppressions, templates and AI drafts, and campaigns, each returning `403 EMAIL_EARLY_ACCESS` until general availability). The full OpenAPI 3.1 specification lives at [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json) and the reference documentation at [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction).

## Packages

| Package | Registry | Description |
|---------|----------|-------------|
| [`@political-comms/sdk`](packages/sdk) | npm | TypeScript SDK. Zero dependencies, native fetch, built-in retries. |
| [`@political-comms/cli`](packages/cli) | npm | Command line interface. `npx @political-comms/cli auth check` |
| [`@political-comms/mcp`](packages/mcp) | npm | MCP server for Claude and other MCP clients. |
| [`political-comms`](python) | PyPI | Python SDK mirroring the TypeScript client. |

## Authentication

Every client authenticates with an API key passed in the `X-API-Key` header. Keys are created in the dashboard under Admin > API and are prefixed `pc_live_`. All packages read the `POLITICAL_COMMS_API_KEY` environment variable by default.

## Development

Node 20 or later and Python 3.10 or later.

```bash
npm install
npm run build
npm test

cd python
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
```

## License

MIT. See [LICENSE](LICENSE).
