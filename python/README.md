# political-comms

Python SDK for the [Political Comms](https://politicalcomms.com/) REST API. Direct-to-carrier political texting for campaigns, PACs, advocacy organizations, fundraisers, and elected officials.

Synchronous client built on httpx. Python 3.10 or later.

The full API reference lives at [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction) and the OpenAPI 3.1 specification at [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json).

## Install

```bash
pip install political-comms
```

## Authentication

Requests authenticate with an API key in the `X-API-Key` header. Keys are created in the dashboard under Admin > API Keys and are prefixed `pc_live_`.

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

One method exists per API operation, in snake_case: `list_organizations`, `get_hierarchy`, `list_brands`, `list_campaigns`, `list_tracking_domains`, `list_phone_numbers`, `list_toll_free_verifications`, `get_toll_free_verification`, `list_contact_lists`, `get_contact_list`, `import_contact_list`, `analyze_contact_list`, `delete_contact_list`, `list_media`, `import_media`, `get_media`, `delete_media`, `list_projects`, `create_project`, `get_all_project_stats`, `get_project`, `update_project`, `get_project_stats`, `test_project`, `schedule_project`, `unschedule_project`, `copy_project`, `archive_project`, `get_message_stats`, `get_ledger_usage`, `get_ledger_usage_by_initiator`.

Every method returns the parsed JSON response, a dict of the form `{"success": True, "data": ...}`.

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
