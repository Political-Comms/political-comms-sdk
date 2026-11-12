# political-comms

Python SDK for the [Political Comms](https://politicalcomms.com/) REST API. Direct-to-carrier political texting for campaigns, PACs, advocacy organizations, fundraisers, and elected officials.

Synchronous client built on httpx. Python 3.10 or later.

The full API reference lives at [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction) and the OpenAPI 3.1 specification at [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json).

## Install

```bash
pip install political-comms
```

## Authentication

Requests authenticate with an API key in the `X-API-Key` header. Keys are created in the dashboard under Admin > API and are prefixed `pc_live_`.

Set the key in the environment:

```bash
export POLITICAL_COMMS_API_KEY=pc_live_...
```

```python
from political_comms import PoliticalCommsClient

client = PoliticalCommsClient()
```

Or pass it to the constructor:

```python
client = PoliticalCommsClient(api_key="pc_live_...")
```

## Quickstart

Verify the credential, then run the standard send workflow: create a project, send yourself a test, and schedule it.

```python
from political_comms import PoliticalCommsClient

client = PoliticalCommsClient()

# 1. Verify the credential.
orgs = client.list_organizations()
print([org.get("display_name") for org in orgs["data"]])

# 2. Create a project.
created = client.create_project(
    organization_id="org_...",
    name="GOTV reminder",
    protocol="sms",
    message_text="Polls are open until 8pm. Find your polling place: {link}",
    phone_number_ids=["pn_..."],
    contact_list_ids=["cl_..."],
    brand_id="brand_...",
    campaign_id="camp_...",
)
project_id = created["data"]["id"]

# 3. Send a test to yourself.
client.test_project(project_id, [{"phone": "+15555550100"}])

# 4. Schedule the send.
client.schedule_project(project_id, "2026-11-03T09:00:00", "America/New_York")
# Optional: skip the reduced rate past the brand's daily T-Mobile carrier limit
# and send T-Mobile recipients at full speed. A carrier rejection still pauses
# the project, and rejected messages are still billed.
# client.schedule_project(
#     project_id, "2026-11-03T09:00:00", "America/New_York", daily_cap_bypass=True
# )
```

One method exists per API operation, in snake_case: `list_organizations`, `get_hierarchy`, `list_brands`, `list_campaigns`, `get_campaign_throughput`, `list_tracking_domains`, `list_phone_numbers`, `list_toll_free_verifications`, `get_toll_free_verification`, `list_contact_lists`, `get_contact_list`, `import_contact_list`, `analyze_contact_list`, `download_contact_list`, `delete_contact_list`, `list_media`, `import_media`, `get_media`, `delete_media`, `list_projects`, `create_project`, `get_all_project_stats`, `get_project`, `update_project`, `get_project_stats`, `get_project_survey_results`, `get_project_throughput`, `test_project`, `schedule_project`, `unschedule_project`, `pause_project`, `start_project`, `end_project`, `add_project_recipient`, `create_project_hook`, `copy_project`, `list_conversations`, `get_conversation`, `list_conversation_messages`, `reply_to_conversation`, `get_message_stats`, `get_ledger_usage`, `get_ledger_usage_by_initiator`.

Every method returns the parsed JSON response, a dict of the form `{"success": True, "data": ...}`.

## Triggered projects and campaigns

A triggered text project or email campaign has no contact list. Recipients arrive one at a
time when its `trigger` fires, and each gets its one message, immediately or after
`delay_minutes`. It stays active until paused or ended. A trigger `source` is `donation`
(a connected WinRed or Anedot list), `event` (a text link click, text reply, email open,
email click, or email reply in another project or campaign), or `api` (you add the
recipient, or a tool POSTs to the inbound hook URL).

```python
project = client.create_project(
    "org_1", "Donor thank-you", "sms", "Thanks {first_name}!", ["pn_1"],
    type="triggered",
    trigger={
        "source": "donation",
        "donation": {"integrations": [{"provider": "winred", "id": "int_1"}]},
        "delay_minutes": 10,
        "reentry": {"mode": "once"},
    },
)["data"]
client.test_project(project["project_id"], [{"phone": "+12025550141"}])
client.start_project(project["project_id"])

# source "api" triggers: add one recipient. occurrence_id makes a retry of the same event a no-op.
result = client.add_project_recipient(
    project["project_id"], "+12025550141",
    fields={"first_name": "Ada", "amount": 25}, occurrence_id="evt_123",
)["data"]  # {"status": "queued", "send_at": ...} or {"status": "already_entered", "reason": ...}

hook_url = client.create_project_hook(project["project_id"])["data"]["hook_url"]  # shown only once
client.end_project(project["project_id"])  # final: recipients still waiting are not sent
```

Email campaigns work the same way: `create_email_campaign(name, sender_identity_id, trigger=...)`
with no `list_ids`, `schedule_email_campaign(id)` with no `scheduled_at` to start, then
`add_email_campaign_recipient`, `create_email_campaign_hook`, and `end_email_campaign`. While
paused, new recipients are refused with a 409, not queued.

## Conversations

A conversation is one thread between one of your sending numbers and one
contact, created by a project send. The API never creates a conversation; it
replies inside an existing one, from the same number, on the same project.
`list_conversations` and `list_conversation_messages` are keyset paginated
like the email endpoints.

```python
# Reply to an inbound message.replied webhook.
client.reply_to_conversation(
    conversation_id, "Thanks for reaching out!", idempotency_key=f"reply-{message_id}"
)

# Reply with an image or video from the media library (one flat-rate MMS).
client.reply_to_conversation(conversation_id, "Here is the flyer", media_ids=[media_id])

# Recover inbound messages missed while a webhook endpoint was down.
page = client.list_conversations(updated_since=last_seen_at)["data"]
for conversation in page["data"]:
    print(conversation["conversation_id"], conversation["status"])
```

## Email

The `/v1/email` surface is wrapped in full: sending domains, sender identities,
suppressions, templates, and campaigns.
Paid and human-driven workflows (AI drafting, result exports)
and deliverability triage (pausing a live send) run in the dashboard.
**Write methods need the email entitlement on the organization and return
`403 ENTITLEMENT_REQUIRED` without it. Reads are open.**

Email endpoints are keyset paginated: the payload is
`{ data, has_more, next_cursor }`. Page until `next_cursor` is null, and never
parse or construct a cursor.

There is no inbound email or inbox surface, and no A/B testing.

```python
# Page through campaigns.
cursor = None
while True:
    page = client.list_email_campaigns(limit=100, cursor=cursor)
    for campaign in page["data"]["data"]:
        print(campaign["name"], campaign["status"])
    cursor = page["data"]["next_cursor"]
    if cursor is None:
        break

# Check what is blocking a campaign before scheduling it.
campaign = client.get_email_campaign(campaign_id)["data"]
if campaign.get("blocked"):
    for reason in campaign["blocked"]:
        print(reason["code"], reason["message"])
else:
    client.schedule_email_campaign(campaign_id, scheduled_at="2026-09-05T15:00:00Z")
```

### Templates

Templates save the HTML a campaign sends. Create also returns `lint`: the save
succeeds either way, but a campaign will not schedule while `lint["errors"]` is
non-empty, so check it at save time rather than at send time. This endpoint
only accepts HTML content; `content["editor"]` is `"html"` for a template
created here, or `"document"` for one built in the dashboard's document
editor, readable over the API as rendered HTML only. Updating the `content`
of a `"document"` template returns `409 CONFLICT` with `details["reason"]`
set to `"TEMPLATE_IS_DOCUMENT"`.

### List imports

`import_contact_list` is the one list import, for phones, emails, or both. The
server fetches a CSV you host over https (50 MB cap) and returns 202. Name the
columns: `phone_column`, `email_column`, or both (there is no automatic email
column detection). `consent` is optional and allowed only for an `audience` list with emails; with `merge_tags`, phones map only the named columns while emails also map every remaining column.
`purpose="do_not_contact"` turns phones into an opt-out list and emails into
unsubscribes, and returns no `list_id`. For an audience import, poll
`get_contact_list(id)`: `import` is the phone side and `email.status` is the
email side.

```python
started = client.import_contact_list(
    "https://example.com/donors.csv",
    "August donors",
    phone_column="Phone",
    email_column="Email",
    merge_tags={"first_name": "First Name"},
    consent={"source": "donation_form", "note": "ActBlue donors, 2026 cycle"},
)["data"]
if started["purpose"] == "audience":
    print(started["list_id"], started["channels"])
```

`list_contact_lists` returns the lists that hold phone numbers by default; pass
`channel="email"` or `channel="all"` for the others. Each list reports its
`channels` and its `email` side (null when it has none).
`delete_contact_list` removes a list's phone numbers and its emails.

Email addresses reach a list only through `import_contact_list` with `email_column`
(a CSV import creates the list, with the email side). Poll `get_contact_list` and
read `email.status` and `email.counts`; read unsubscribes and bounces with
`list_email_suppressions`.

## Error handling

Non-success responses raise `PoliticalCommsError` with the API's machine readable `code`, the HTTP `status_code`, and the raw response `body`.

```python
from political_comms import PoliticalCommsClient, PoliticalCommsError

client = PoliticalCommsClient()
try:
    client.get_project("proj_unknown")
except PoliticalCommsError as err:
    print(err.code, err.status_code, err)
```

Network failures raise `PoliticalCommsError` with `code == "NETWORK_ERROR"` and `status_code == 0`.

## Retries

The client retries automatically with these rules:

- `400`, `401`, `403`, `404` are never retried.
- `429` is retried after waiting until the `X-RateLimit-Reset` timestamp.
- `500`, `502`, `503`, `504` are retried with exponential backoff and jitter: 1 second base, 60 second cap, at most 5 attempts total.

Configure the retry budget with `max_retries` (retries after the first attempt, default 4):

```python
client = PoliticalCommsClient(max_retries=2)
```

Every `POST` and `PATCH` request carries an `Idempotency-Key` header (a random UUID) so retries are safe; the API returns the cached first response when a key is replayed. `DELETE` requests send the header only when you supply a key. Supply your own key per call when you need cross-process deduplication:

```python
client.create_project(..., idempotency_key="send-2026-11-03-wave-1")
```

## Rate limits

The API allows 600 requests per minute per key: bursts of up to 600 at once, refilling at 10 per second, the same for every scope. The client exposes the most recent rate limit headers:

```python
client.list_organizations()
print(client.last_rate_limit)
# RateLimitState(limit=100, remaining=97, reset=1767225600)  (reset is Unix seconds)
```

## License

MIT. Questions: support@politicalcomms.com
