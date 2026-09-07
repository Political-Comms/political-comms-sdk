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
# Optional: run the whole project past the brand's daily T-Mobile carrier limit
# instead of pausing at it each day. Over-limit messages to T-Mobile recipients
# may fail and are still billed.
# client.schedule_project(
#     project_id, "2026-11-03T09:00:00", "America/New_York", daily_cap_bypass=True
# )
```

One method exists per API operation, in snake_case: `list_organizations`, `get_hierarchy`, `list_brands`, `list_campaigns`, `list_tracking_domains`, `list_phone_numbers`, `list_toll_free_verifications`, `get_toll_free_verification`, `list_contact_lists`, `get_contact_list`, `import_contact_list`, `analyze_contact_list`, `delete_contact_list`, `list_media`, `import_media`, `get_media`, `delete_media`, `list_projects`, `create_project`, `get_all_project_stats`, `get_project`, `update_project`, `get_project_stats`, `test_project`, `schedule_project`, `unschedule_project`, `copy_project`, `list_conversations`, `get_conversation`, `list_conversation_messages`, `reply_to_conversation`, `get_message_stats`, `get_ledger_usage`, `get_ledger_usage_by_initiator`.

Every method returns the parsed JSON response, a dict of the form `{"success": True, "data": ...}`.

## Conversations

A conversation is one thread between one of your sending numbers and one
contact, created by a project send. The API never creates a conversation; it
replies inside an existing one, from the same number, on the same project.
`list_conversations` and `list_conversation_messages` are keyset paginated
like the email lists.

```python
# Reply to an inbound message.replied webhook.
client.reply_to_conversation(
    conversation_id, "Thanks for reaching out!", idempotency_key=f"reply-{message_id}"
)

# Recover inbound messages missed while a webhook endpoint was down.
page = client.list_conversations(updated_since=last_seen_at)["data"]
for conversation in page["data"]:
    print(conversation["conversation_id"], conversation["status"])
```

## Email (early access)

The `/v1/email` surface is wrapped in full: sending domains, sender identities,
lists and contacts, list imports, suppressions, templates, and campaigns.
Paid and human-driven workflows (AI drafting, list validation, result exports)
and deliverability triage (pausing a live send) run in the dashboard. **Every email method returns `403 EMAIL_EARLY_ACCESS` until the
email product reaches general availability.**
The contract is stable, so integrations can be written against it now.

Email lists are keyset paginated: the payload is
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

`start_email_list_import` fetches a CSV you host over https (50 MB cap) and
commits it in one call. Omit `mapping` to let the server recognize a common ESP
export; when neither your mapping nor the recognizer finds an email column the
call is a `400 VALIDATION_ERROR` whose `details["headers"]` lists the headers
that were read, so you can retry with a mapping instead of guessing. The call
returns 202; the import's progress is shown on the list in the dashboard.

```python
started = client.start_email_list_import(
    "https://example.com/donors.csv",
    "lst_1",
    {"source": "donation_form", "note": "ActBlue donors, 2026 cycle"},
)["data"]
print(started["id"])
```

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

The API allows, per key over a 60-second sliding window, 100 requests/minute for reads, 60/minute for writes, and 30/minute for deletes. The client exposes the most recent rate limit headers:

```python
client.list_organizations()
print(client.last_rate_limit)
# RateLimitState(limit=100, remaining=97, reset=1767225600)  (reset is Unix seconds)
```

## License

MIT. Questions: support@politicalcomms.com
