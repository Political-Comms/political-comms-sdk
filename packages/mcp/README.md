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

Set `POLITICAL_COMMS_BASE_URL` to point the server at another API host (for example a
staging API); it defaults to `https://api.politicalcomms.com/v1`.

## Tools

Read only:

| Tool | Description |
|------|-------------|
| `list_organizations` | List organizations visible to the API key. Doubles as a credential check. |
| `get_hierarchy` | Full organization hierarchy tree with brands. |
| `list_projects` | List messaging projects, filterable by organization, brand, or campaign. |
| `get_project` | Full configuration of one project. |
| `get_project_stats` | Delivery and engagement stats for one project. |
| `get_project_survey_results` | Topline survey results for a survey project: per-question option counts and percentages, completion and dropoff rates. Returns a 409 `NOT_A_SURVEY` error for other projects. |
| `get_project_throughput` | Carrier-limit estimate for one project: recipients per carrier and how long AT&T takes (`will_pause` is always false). |
| `get_campaign_throughput` | A campaign's T-Mobile daily cap, use today, and AT&T per-minute rates. |
| `list_contact_lists` | Contact lists, each with its `channels` (`text`, `email`) and `email` side. `channel` is `text` (default), `email`, or `all`. |
| `get_contact_list` | One contact list with import progress, analysis, and `downloads` URLs. A failed import side carries `error` (`{ code, message }`) saying why. |
| `download_contact_list` | A contact list as CSV text (`type` original or analyzed), truncated at 100,000 characters. |
| `get_message_stats` | Aggregate message stats for a date range. |
| `get_ledger_usage` | Billing usage for a date range. |
| `list_tags` | Contact tags of one organization: manual tags with a member count, activity tags (`donated`, `clicked`, `responded`, `sent`, optionally within N days), and each tag's `live_triggers` (the started triggered projects and campaigns listening for it). |
| `list_conversations` | Conversations with at least one inbound message, sorted by last inbound message. |
| `get_conversation` | One conversation: status, contact, message counts, last activity. |
| `list_conversation_messages` | Messages in one conversation, newest first. |
| `list_webhook_endpoints` | Outbound webhook endpoints with delivery health (`enabled`, `failing_since`, `disabled_reason`). Read-only. |
| `get_webhook_endpoint` | One webhook endpoint: URL, event types, and delivery health. The signing secret is never returned. |
| `list_email_domains` | Email sending domains and their DNS verification status. |
| `get_email_domain` | One sending domain, including the DNS records to publish. |
| `list_email_senders` | Email sender identities (From addresses). |
| `list_email_suppressions` | Suppressed addresses at org, identity, or list scope. |
| `list_email_campaigns` | Email campaigns with status and audience counts. |
| `get_email_campaign` | One campaign, including `blocked`: why it will not schedule. |
| `get_email_campaign_stats` | Report tiles and per-link clicks. |
| `list_email_templates` | Saved email templates with subject and last-updated time. |
| `get_email_template` | One template including its full HTML body. |

Write (each is annotated as non read-only; `create_project`, `test_project`, `schedule_project`, `start_project`, `add_project_recipient`, `reply_to_conversation`, `schedule_email_campaign`, `resume_email_campaign`, `add_email_campaign_recipient`, `add_tag_contacts`, and `import_contact_list` additionally require `confirm: true` because they send real messages or write contacts):

| Tool | Description |
|------|-------------|
| `import_contact_list` | Import a CSV as a new list of phones, emails, or both, or as a do-not-contact list; an audience import can tag its contacts (`tag_ids`, `tag_names`, `tags_column`), and `fire_triggers` (default false) enters newly tagged contacts into those tags' live triggers. Requires `confirm: true`. |
| `create_tag` | Create a manual tag by `name`, or an activity tag by `activity_event` and optional `within_days`. |
| `rename_tag` | Rename a manual tag. |
| `add_tag_contacts` | Put a manual tag, named by `name` or by `id`, on phone numbers or email addresses (`identifiers`) or on everyone on a list (`contact_list_id`). A `name` creates the tag when none has it (ignoring case); the result's `created` says so. `identifiers` return counts; a `contact_list_id` is tagged in the background and returns `queued: true` and a `job_id` with no counts, and the outcome shows as the tag's `member_count` in `list_tags` once it finishes. `fire_triggers` (default true for `identifiers`, false for a list) says whether newly tagged contacts enter the tag's live triggers, which messages them; the result carries `triggers.entered`. Requires `confirm: true`. |
| `create_project` | Create a draft messaging project, or a triggered project (`type: triggered` with a `trigger`, no contact list). Recipients are `contact_list_ids` plus contacts carrying ANY `tag_ids` tag; `require_tag_ids` keeps only contacts carrying ALL of its tags; `suppression_tag_ids` leaves tagged contacts out. A tagged contact is only sent to when it is on a live list the sender can use. Takes `follow_ups`, a tag trigger (`source: tag`), and `trigger.start` (`immediate` or `next_day`) with `scheduled_timezone` and `sequence_send_time`. |
| `test_project` | Send real test messages to explicit phone numbers. Numbers ending 555-0100 to 555-0199 are [test phone numbers](https://docs.politicalcomms.com/api-reference/testing) that never reach a phone and return a fixed outcome. |
| `schedule_project` | Commit a bulk send at a specific date and time. |
| `unschedule_project` | Remove a project's schedule. |
| `pause_project` | Pause a running or scheduled send; resume with `schedule_project`. |
| `start_project` | Start or resume a triggered project; a tag trigger's first start takes `audience` (`current_and_new` or `new_only`). Requires `confirm: true`. |
| `end_project` | End a triggered project. Final: recipients still waiting are not sent. |
| `add_project_recipient` | Add one recipient to an active triggered project; sends a real text. Requires `confirm: true`. |
| `create_project_hook` | Mint the inbound hook URL (Zapier, Make, n8n) for a triggered project; replaces any previous URL. |
| `copy_project` | Copy a project into a new draft (drops lists, schedule, and stats). |
| `reply_to_conversation` | Send a real reply (text, one `media_ids` entry for MMS, or both) inside an existing conversation. Requires `confirm: true`. |
| `schedule_email_campaign` | Commit an email send. Requires `confirm: true`. |
| `unschedule_email_campaign` | Return a scheduled campaign to a draft state. |
| `pause_email_campaign` | Pause a scheduled, compiling, or sending email campaign (`pause_reason: api`); the platform never resumes it. Safe to repeat. |
| `resume_email_campaign` | Resume a paused email campaign now, or at `resume_at`; sends mail. Requires `confirm: true`. |
| `end_email_campaign` | End a triggered email campaign. Final. |
| `add_email_campaign_recipient` | Add one recipient to a triggered email campaign; sends a real email. Requires `confirm: true`. |
| `create_email_campaign_hook` | Mint the inbound hook URL for a triggered email campaign; replaces any previous URL. |

Tagging by name is the simplest path: no tag has to exist first.

```json
{ "name": "add_tag_contacts", "arguments": { "confirm": true, "name": "Volunteers", "identifiers": ["(202) 555-0101", "ada@example.org"] } }
```

The result carries the `tag` (its `id` goes in `create_project` `tag_ids`) and `created`.
The tool description tells an agent to pass a name exactly as `list_tags` returned it,
so a variant spelling does not create a near-duplicate tag, and to report `created: true`.

The server deliberately exposes no delete operations, so deleting a tag and untagging
contacts (both need the `public:delete` permission) stay in the SDK, the CLI, and the dashboard.

### Trigger on a tag

A triggered project or campaign with `trigger: { source: "tag", tag: { tag_ids: [...] } }`
messages each contact newly tagged with one of those tags, at most once per person. Its
first start asks who: `current_and_new` (everyone carrying the tag now too) or `new_only`.

```json
{ "name": "start_project", "arguments": { "confirm": true, "id": "proj_123", "audience": "new_only" } }
```

From then on, tagging a contact into that tag MESSAGES them. The `add_tag_contacts` and
`import_contact_list` descriptions tell an agent to read `live_triggers` from `list_tags`
first, and to get the user's explicit yes before sending `fire_triggers: true` for a list
or an import; that yes is the `confirm: true`.

### Follow-ups

`create_project` takes up to 9 follow-up texts after the first message. A person stops
getting them on a reply (`stop_on_reply`), a tracked-link click (`stop_on_click`), or an
opt-out; each follow-up is charged when it sends. Day waits send at `sequence_send_time`
in `scheduled_timezone`.

```json
{
  "name": "create_project",
  "arguments": {
    "confirm": true, "organization_id": "org_1", "name": "Early vote", "protocol": "sms",
    "phone_number_ids": ["pn_1"], "brand_id": "brand_1", "campaign_id": "camp_1",
    "contact_list_ids": ["cl_1"], "message_text": "Early voting starts Monday.",
    "follow_ups": {
      "steps": [{ "message_text": "Find your polling place: https://example.org/vote", "wait": { "unit": "days", "amount": 2 } }],
      "stop_on_reply": true, "stop_on_click": true
    },
    "scheduled_timezone": "America/Chicago", "sequence_send_time": "09:00"
  }
}
```

### Email tools

Email write tools need the email entitlement on the organization and return
`403 ENTITLEMENT_REQUIRED` without it; reads are open. Paid and human-driven email workflows (AI
drafting, result exports) are dashboard features rather than tools: they cost
money or need a human watching a send. Pausing and resuming a live send are tools
(`pause_email_campaign`, `resume_email_campaign`); a resume that returns
`EMAIL_CAMPAIGN_TEST_REQUIRED` needs a test send from the dashboard first. There is no inbound email or inbox
surface.

## Errors

API errors are returned as tool errors with the machine readable code and a recovery hint. Rate limited requests (600 requests/minute per key) mention the `X-RateLimit-Reset` wait; authentication failures explain that a human must create a key in the dashboard.

Full API reference: [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction). OpenAPI spec: [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json).

## License

MIT. Questions: support@politicalcomms.com
