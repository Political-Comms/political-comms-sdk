# @political-comms/mcp

MCP (Model Context Protocol) server for the [Political Comms](https://politicalcomms.com/) REST API. Lets Claude and other MCP clients inspect organizations, projects, contact lists, analytics, and billing, and create, test, and schedule compliant political SMS and MMS sends in the US.

Runs over stdio. Requires Node 20 or later and a Political Comms API key (created in the dashboard under Admin > API, prefixed `pc_live_`).

## Setup

### Claude Code

```bash
claude mcp add political-comms \
  --env POLITICAL_COMMS_API_KEY=pc_live_... \
  -- npx -y @political-comms/mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "political-comms": {
      "command": "npx",
      "args": ["-y", "@political-comms/mcp"],
      "env": {
        "POLITICAL_COMMS_API_KEY": "pc_live_..."
      }
    }
  }
}
```

## Tools

Read only:

| Tool | Description |
|------|-------------|
| `list_organizations` | List organizations visible to the API key. Doubles as a credential check. |
| `get_hierarchy` | Full organization hierarchy tree with brands. |
| `list_projects` | List messaging projects, filterable by organization, brand, or campaign. |
| `get_project` | Full configuration of one project. |
| `get_project_stats` | Delivery and engagement stats for one project. |
| `list_contact_lists` | Contact lists with counts and status. |
| `get_contact_list` | One contact list with import progress and analysis. |
| `get_message_stats` | Aggregate message stats for a date range. |
| `get_ledger_usage` | Billing usage for a date range. |
| `list_email_domains` | Email sending domains and their DNS verification status. |
| `get_email_domain` | One sending domain, including the DNS records to publish. |
| `list_email_senders` | Email sender identities (From addresses). |
| `list_email_lists` | Email lists with contact counts and status. |
| `get_email_list_validation` | Status of the latest paid validation run for a list. |
| `list_email_suppressions` | Suppressed addresses at org, identity, or list scope. |
| `list_email_campaigns` | Email campaigns with status and audience counts. |
| `get_email_campaign` | One campaign, including `blocked`: why it will not schedule. |
| `get_email_campaign_stats` | Report tiles and per-link clicks. |
| `list_email_templates` | Saved email templates with subject and last-updated time. |
| `get_email_template` | One template including its full HTML body. |
| `get_email_template_draft` | One AI draft: status, subject, and HTML once ready. |
| `get_email_list_import` | One CSV import: headers read, mapping applied, summary. |

Write (each is annotated as non read-only; `create_project`, `test_project`, and `schedule_project` additionally require `confirm: true` because they stage or send real messages):

| Tool | Description |
|------|-------------|
| `create_project` | Create a draft messaging project. |
| `test_project` | Send real test messages to explicit phone numbers. |
| `schedule_project` | Commit a bulk send at a specific date and time. |
| `unschedule_project` | Remove a project's schedule. |
| `copy_project` | Copy a project into a new draft (drops lists, schedule, and stats). |
| `archive_project` | Archive a completed project. |
| `schedule_email_campaign` | Commit an email send. Requires `confirm: true`. |
| `unschedule_email_campaign` | Return a scheduled campaign to a draft state. |
| `pause_email_campaign` | Pause a sending campaign. |
| `resume_email_campaign` | Resume a paused campaign. Requires `confirm: true`. |
| `create_email_template_draft` | Generate an email design from a prompt. **Costs $3.00 per finished draft.** Requires `confirm: true`. |
| `start_email_list_import` | Import a CSV of contacts into an email list. Requires `confirm: true`. |

The server deliberately exposes no delete operations.

### Email tools are early access

Every `*_email_*` tool returns `403 EMAIL_EARLY_ACCESS` until the email product
reaches general availability. `create_email_template_draft` is the one tool that
spends money on its own: each draft that finishes is billed $3.00 by default
(per-org pricing), a draft that fails is never billed, and a wallet that cannot
cover it is refused up front with `402 INSUFFICIENT_BALANCE`. Drafting is
asynchronous: poll `get_email_template_draft` until status is `ready` or
`failed`. `resume_email_campaign` requires `confirm: true`
because a campaign a deliverability breaker auto-paused twice returns
`409 EMAIL_CAMPAIGN_RESUME_REQUIRES_SUPPORT`, which no retry will clear: that one
needs a human. There is no inbound email or inbox surface.

## Errors

API errors are returned as tool errors with the machine readable code and a recovery hint. Rate limited requests (100/min reads, 60/min writes, 30/min deletes per key) mention the `X-RateLimit-Reset` wait; authentication failures explain that a human must create a key in the dashboard.

Full API reference: [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction). OpenAPI spec: [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json).

## License

MIT. Questions: support@politicalcomms.com
