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

A test, or any send, can also target a test phone number such as `+12025550101` (any number ending 555-0100 through 555-0199) to get a fixed delivered or failed outcome without texting a real phone. See [Test phone numbers](https://docs.politicalcomms.com/api-reference/testing).

One method exists per API operation, in snake_case: `list_organizations`, `get_hierarchy`, `list_brands`, `list_campaigns`, `get_campaign_throughput`, `list_tracking_domains`, `list_phone_numbers`, `list_webhook_endpoints`, `get_webhook_endpoint`, `list_toll_free_verifications`, `get_toll_free_verification`, `list_contact_lists`, `get_contact_list`, `import_contact_list`, `analyze_contact_list`, `download_contact_list`, `delete_contact_list`, `list_tags`, `create_tag`, `rename_tag`, `delete_tag`, `add_tag_contacts`, `remove_tag_contacts`, `tag_contacts`, `untag_contacts`, `list_media`, `import_media`, `get_media`, `delete_media`, `list_projects`, `create_project`, `get_all_project_stats`, `get_project`, `update_project`, `get_project_stats`, `get_project_survey_results`, `get_project_throughput`, `test_project`, `schedule_project`, `unschedule_project`, `pause_project`, `start_project`, `end_project`, `add_project_recipient`, `create_project_hook`, `copy_project`, `list_conversations`, `get_conversation`, `list_conversation_messages`, `reply_to_conversation`, `get_message_stats`, `get_ledger_usage`, `get_ledger_usage_by_initiator`.

Every method returns the parsed JSON response, a dict of the form `{"success": True, "data": ...}`.

## Triggered projects and campaigns

A triggered text project or email campaign has no contact list. Recipients arrive one at a
time when its `trigger` fires. A phone number or email address is sent a triggered project
or campaign at most once. The first message goes `"start": "immediate"` (the default, after
`delay_minutes`) or `"start": "next_day"`: the day after the trigger fired at the project's
`sequence_send_time` in its `scheduled_timezone` (a campaign's `timezone`), with
`delay_minutes` 0. It stays active until paused or ended. A trigger `source` is `donation`
(a connected WinRed or Anedot list), `event` (a text link click, text reply, email open,
email click, or email reply in another project or campaign), `tag` (a contact was tagged;
see below), or `api` (you add the recipient, or a tool POSTs to the inbound hook URL).

```python
project = client.create_project(
    "org_1", "Donor thank-you", "sms", "Thanks {first_name}!", ["pn_1"],
    type="triggered",
    trigger={
        "source": "donation",
        "donation": {"integrations": [{"provider": "winred", "id": "int_1"}]},
        "delay_minutes": 10,
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

### Trigger on a tag

`"source": "tag"` fires when a contact is newly tagged with any of `tag.tag_ids` (1-20
manual tags): a tagged phone enters a triggered project, a tagged email address a
triggered campaign. Re-tagging a contact that already carries the tag never fires. The
first start asks who to send to: `current_and_new` (everyone carrying the tag now, entered
in the background, plus everyone tagged later) or `new_only`.

```python
welcome = client.create_project(
    "org_1", "Welcome volunteers", "sms", "Welcome aboard, {first_name}!", ["pn_1"],
    type="triggered",
    trigger={"source": "tag", "tag": {"tag_ids": [volunteers_tag_id]}, "start": "next_day"},
    scheduled_timezone="America/New_York",
    sequence_send_time="10:00",
)["data"]
client.start_project(welcome["project_id"], audience="new_only")
# Email: client.schedule_email_campaign(campaign_id, audience="new_only")
```

Once a tag has a live trigger, tagging contacts into it MESSAGES them. `list_tags` shows
each tag's `live_triggers`; `add_tag_contacts`, `tag_contacts`, and `import_contact_list`
take `fire_triggers` (default true for `identifiers`, false for a `contact_list_id` or an
import), and a 200 reports `triggers["entered"]`.

## Follow-ups

Any broadcast or triggered text project can send up to 9 follow-up texts after its first
message (surveys cannot). Each waits `{"unit": "days", "amount": 1-365}`, sent at the
project's `sequence_send_time` in its `scheduled_timezone` (required in the same call), or
`{"unit": "hours", "amount": 1-72}`. A person stops getting them when they reply
(`stop_on_reply`), click a tracked link (`stop_on_click`), or opt out; at least one of the
two flags must be true. Each follow-up is charged when it sends, and a person whose first
message failed gets none. Follow-ups are locked once the project starts (409);
`update_project(id, clear_follow_ups=True)` removes them before then.

```python
client.create_project(
    org_id, "Early vote", "sms", "Early voting starts Monday.", [phone_number_id], [list_id],
    brand_id=brand_id,
    campaign_id=campaign_id,
    follow_ups={
        "steps": [
            {"message_text": "Find your polling place: https://example.org/vote", "wait": {"unit": "days", "amount": 2}},
            {"message_text": "Polls close at 7 tonight.", "wait": {"unit": "hours", "amount": 6}},
        ],
        "stop_on_reply": True,
        "stop_on_click": True,
    },
    scheduled_timezone="America/Chicago",
    sequence_send_time="09:00",
)
```

Email campaigns take follow-ups as `sequence` (`steps` of `template_id`, `delay_days`,
`send_time`, with `stop_on_reply` and `stop_on_click`); such a campaign reads
`type` `"broadcast"`. A triggered email campaign can have follow-ups too: beside a `trigger`,
each person's follow-up goes `delay_days` (1 to 365) after the calendar day their own previous
email was sent, in the campaign's `timezone`; email follow-ups wait whole days.

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

## Tags

A tag labels a contact (a phone number or an email address) inside one organization.
Manual tags have members you add and remove; activity tags (`donated`, `clicked`,
`responded`, `sent`, optionally within the last `within_days` days) apply by themselves
and are evaluated when a send compiles.

The simplest way to tag is by name: `tag_contacts` finds the manual tag with that name
(ignoring case) or creates it, and `created` says which happened, so a misspelled name
that made a new tag is easy to catch. `untag_contacts` takes the same arguments and never
creates a tag. Sends refer to tags by id, so keep the returned `tag["id"]`.

Tagging by `identifiers` answers with counts (`added` or `removed`, `invalid`). Tagging a
whole list by `contact_list_id` runs in the background: the call answers 202 with
`{"queued": True, "job_id": ...}` and no counts (by name, the `tag` and `created` too,
since the tag is created immediately). There is no job status endpoint; the outcome
shows as the tag's `member_count` on `list_tags` once the job finishes.

```python
tagged = client.tag_contacts("Volunteers", ["(202) 555-0101", "ada@example.org"])["data"]
tag = tagged["tag"]  # tagged["created"] is True when this call created it
job = client.add_tag_contacts(tag["id"], contact_list_id=list_id)["data"]  # every active phone and subscribed address
# a list is tagged in the background: job is {"queued": True, "job_id": ...}, no counts
donors = client.create_tag(activity_event="donated", within_days=90)["data"]

client.create_project(
    org_id, "Volunteer call", "sms", "Shifts open Saturday.", [phone_number_id],
    [list_id],
    brand_id=brand_id,
    campaign_id=campaign_id,
    tag_ids=[tag["id"]],              # also send to contacts carrying ANY of these
    require_tag_ids=[donors["id"]],   # keep only contacts carrying ALL of these
    suppression_tag_ids=[staff_tag_id],  # leave these out of this send
)
```

`create_project` and `update_project` (broadcast and survey projects alike) and
`create_email_campaign` take the three tag fields; a campaign needs `list_ids` or `tag_ids`. A tagged contact is only sent to
through a list row the sender can use: a tagged phone must be on a live list the
project's sender can use (unscoped, or scoped to the project's own brand, toll-free
number, or short code), and a tagged address must be subscribed on a list the sending
domain can use. Opt-outs and unsubscribes always apply. `import_contact_list` can tag an
`audience` import with `tag_ids`, `tag_names`, or `tags_column`. A 409 `TAG_IN_USE` from
`delete_tag` lists the live sends using the tag in `error.body["details"]`.

## Webhook endpoints

`list_webhook_endpoints` and `get_webhook_endpoint` read the outbound webhook endpoints of
your organization. They are read-only: endpoints and their signing secret are created and
edited in the dashboard. `failing_since` is the start of the current run of failed deliveries
(`None` while healthy), and `disabled_reason` is `"consecutive_failures"` when the platform
switched an endpoint off after 3 days with no successful delivery. The list is keyset
paginated: page until `next_cursor` is `None`. The API key needs the `public:read` permission.

```python
page = client.list_webhook_endpoints(limit=100)["data"]
for endpoint in page["data"]:
    if not endpoint["enabled"] or endpoint["failing_since"]:
        print(endpoint["name"], endpoint["disabled_reason"])
```

## Email

The `/v1/email` surface is wrapped in full: sending domains, sender identities,
suppressions, templates, and campaigns.
Paid and human-driven workflows (AI drafting, result exports) run in the dashboard.
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

### Pause and resume

`pause_email_campaign(id)` pauses a `scheduled`, `compiling`, or `sending` campaign with
`pause_reason` `"api"`; the platform never resumes an `api` pause by itself.
`resume_email_campaign(id, resume_at=None)` resumes it now, or with a `resume_at` more than a
minute ahead keeps it paused and resumes it at that time (the campaign's `resume_at` shows the
plan; a later pause cancels it). Resume clears any pause reason, but if the cause still holds
the platform pauses it again. Only `api`, `manual`, and `provider_refused` pauses wait for a
person; the rest resume on their own once the cause clears. Resume raises `409 SENDING_PAUSED`
while sending is suspended and `409 EMAIL_CAMPAIGN_TEST_REQUIRED` when content changed during
the pause (send a test from the dashboard, then resume).

```python
client.pause_email_campaign(campaign_id)
client.resume_email_campaign(campaign_id)  # now
client.resume_email_campaign(campaign_id, resume_at="2026-12-01T15:00:00Z")  # planned
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
`channels` and its `email` side (null when it has none). When `get_contact_list`
reports `import.status` or `email.status` `failed`, that side's `error`
(`{"code", "message"}`, `None` otherwise) says why; the message is safe to show an end user.
`delete_contact_list` removes a list's phone numbers and its emails.

API key permissions follow the HTTP method: GET needs `public:read`; POST, PATCH, and PUT need `public:write`; DELETE needs `public:write` and `public:delete`. A write-only key can create and change things but cannot read. The delete methods (`delete_contact_list`, `delete_media`, `delete_tag`, `remove_tag_contacts`, `untag_contacts`, `remove_email_suppressions`) therefore need `public:delete`, which is opt-in when the key is created; other keys get a 403.

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
