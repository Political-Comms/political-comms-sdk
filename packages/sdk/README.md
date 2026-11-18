# @political-comms/sdk

TypeScript SDK for the [Political Comms](https://politicalcomms.com/) REST API. Direct-to-carrier political texting for campaigns, PACs, advocacy organizations, fundraisers, and elected officials.

Zero runtime dependencies. Uses native fetch. Node 20 or later.

The full API reference lives at [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction) and the OpenAPI 3.1 specification at [politicalcomms.com/openapi.json](https://politicalcomms.com/openapi.json).

## Install

```bash
npm install @political-comms/sdk
```

## Authentication

Requests authenticate with an API key in the `X-API-Key` header. Keys are created in the dashboard under Admin > API and are prefixed `pc_live_`.

Set the key in the environment:

```bash
export POLITICAL_COMMS_API_KEY=pc_live_...
```

```ts
import { PoliticalCommsClient } from '@political-comms/sdk';

const client = new PoliticalCommsClient();
```

Or pass it to the constructor:

```ts
const client = new PoliticalCommsClient({ apiKey: 'pc_live_...' });
```

## Quickstart

Verify the credential, then run the standard send workflow: create a project, send yourself a test, and schedule it.

```ts
import { PoliticalCommsClient } from '@political-comms/sdk';

const client = new PoliticalCommsClient();

// 1. Verify the credential.
const orgs = await client.listOrganizations();
console.log(orgs.data.map((o) => o.display_name));

// 2. Create a project.
const created = await client.createProject({
  organization_id: 'org_...',
  brand_id: 'brand_...',
  campaign_id: 'camp_...',
  phone_number_ids: ['pn_...'],
  name: 'GOTV reminder',
  protocol: 'sms',
  contact_list_ids: ['cl_...'],
  message_text: 'Polls are open until 8pm. Find your polling place: {link}',
});
const projectId = created.data.id!;

// 3. Send a test to yourself.
await client.testProject(projectId, {
  test_contacts: [{ phone: '+15555550100' }],
});

// 4. Schedule the send.
await client.scheduleProject(projectId, {
  scheduled_at: '2026-11-03T09:00:00',
  scheduled_timezone: 'America/New_York',
  // Optional. Past a brand's T-Mobile daily limit, T-Mobile recipients send at
  // a reduced rate; set this to skip the reduced rate and send them at full
  // speed. A carrier rejection still pauses the project, and rejected messages
  // are still billed. Defaults to false.
  // daily_cap_bypass: true,
});
```

A test, or any send, can also target a test phone number such as `+12025550101` (any number ending 555-0100 through 555-0199) to get a fixed delivered or failed outcome without texting a real phone. See [Test phone numbers](https://docs.politicalcomms.com/api-reference/testing).

One method exists per API operation, named after its `operationId`: `listOrganizations`, `getHierarchy`, `listBrands`, `listCampaigns`, `getCampaignThroughput`, `listTrackingDomains`, `listPhoneNumbers`, `listWebhookEndpoints`, `getWebhookEndpoint`, `listTollFreeVerifications`, `getTollFreeVerification`, `listContactLists`, `getContactList`, `importContactList`, `analyzeContactList`, `downloadContactList`, `deleteContactList`, `listTags`, `createTag`, `renameTag`, `deleteTag`, `addTagContacts`, `removeTagContacts`, `tagContacts`, `untagContacts`, `listMedia`, `importMedia`, `getMedia`, `deleteMedia`, `listProjects`, `createProject`, `getAllProjectStats`, `getProject`, `updateProject`, `getProjectStats`, `getProjectSurveyResults`, `getProjectThroughput`, `testProject`, `scheduleProject`, `unscheduleProject`, `pauseProject`, `startProject`, `endProject`, `addProjectRecipient`, `createProjectHook`, `copyProject`, `listConversations`, `getConversation`, `listConversationMessages`, `replyToConversation`, `getMessageStats`, `getLedgerUsage`, `getLedgerUsageByInitiator`.

## Triggered projects and campaigns

A triggered text project or email campaign has no contact list. Recipients arrive one at a
time when its `trigger` fires. A phone number or email address is sent a triggered project
or campaign at most once. The first message goes `start: 'immediate'` (the default, after
`delay_minutes`) or `start: 'next_day'`: the day after the trigger fired at the project's
`sequence_send_time` in its `scheduled_timezone` (a campaign's `timezone`), with
`delay_minutes` 0. It stays active until paused or ended. A trigger `source` is `donation`
(a connected WinRed or Anedot list), `event` (a text link click, text reply, email open,
email click, or email reply in another project or campaign), `tag` (a contact was tagged;
see below), or `api` (you add the recipient, or a tool POSTs to the inbound hook URL).

```ts
const { data: project } = await client.createProject({
  type: 'triggered',
  organization_id: 'org_1',
  phone_number_ids: ['pn_1'],
  name: 'Donor thank-you',
  protocol: 'sms',
  message_text: 'Thanks {first_name}, your ${amount} gift matters.',
  trigger: {
    source: 'donation',
    donation: { integrations: [{ provider: 'winred', id: 'int_1' }], gift: 'one_time' },
    delay_minutes: 10,
  },
});

await client.testProject(project!.project_id!, { test_contacts: [{ phone: '+12025550141' }] });
await client.startProject(project!.project_id!);

// source: 'api' triggers: add one recipient. occurrence_id makes a retry of the same event a no-op.
const { data } = await client.addProjectRecipient(id, {
  phone_number: '+12025550141',
  fields: { first_name: 'Ada', amount: 25 },
  occurrence_id: 'evt_123',
});
if (data.status === 'queued') console.log('sends at', data.send_at);
else console.log('skipped:', data.reason); // duplicate | already_entered

const { data: hook } = await client.createProjectHook(id); // hook.hook_url (or hook.endpoint_url + hook.secret in X-Hook-Secret), shown only once
await client.endProject(id); // final: recipients still waiting are not sent
```

Email campaigns work the same way: `createEmailCampaign({ ..., trigger })` with no `list_ids`,
`scheduleEmailCampaign(id)` with no `scheduled_at` to start, then `addEmailCampaignRecipient`,
`createEmailCampaignHook`, and `endEmailCampaign`. While paused, new recipients are refused
with a 409, not queued. Opted-out phone numbers and suppressed addresses are never sent to
(409 `CONTACT_OPTED_OUT` or a 422).

### Trigger on a tag

`source: 'tag'` fires when a contact is newly tagged with any of `tag.tag_ids` (1-20 manual
tags): a tagged phone enters a triggered project, a tagged email address a triggered
campaign. Re-tagging a contact that already carries the tag never fires. The first start
asks who to send to: `current_and_new` (everyone carrying the tag now, entered in the
background, plus everyone tagged later) or `new_only`.

```ts
const { data: welcome } = await client.createProject({
  ...projectSetup,
  type: 'triggered',
  message_text: 'Welcome aboard, {first_name}!',
  trigger: { source: 'tag', tag: { tag_ids: [volunteersTagId] }, start: 'next_day' },
  scheduled_timezone: 'America/New_York',
  sequence_send_time: '10:00',
});
await client.startProject(welcome!.project_id!, { audience: 'new_only' });
// Email: scheduleEmailCampaign(id, { audience: 'new_only' }).
```

Once a tag has a live trigger, tagging contacts into it MESSAGES them. `listTags` shows each
tag's `live_triggers`; `addTagContacts`, `tagContacts`, and `importContactList` take
`fire_triggers` (default true for `identifiers`, false for a `contact_list_id` or an
import), and a 200 reports `triggers.entered`.

## Follow-ups

Any broadcast or triggered text project can send up to 9 follow-up texts after its first
message (surveys cannot). Each waits `{ unit: 'days', amount: 1-365 }`, sent at the
project's `sequence_send_time` in its `scheduled_timezone` (required in the same write), or
`{ unit: 'hours', amount: 1-72 }`. A person stops getting them when they reply
(`stop_on_reply`), click a tracked link (`stop_on_click`), or opt out; at least one of the
two flags must be true. Each follow-up is charged when it sends, and a person whose first
message failed gets none. Follow-ups are locked once the project starts (409); send
`follow_ups: null` before then to clear them.

```ts
await client.createProject({
  ...projectSetup,
  contact_list_ids: [listId],
  message_text: 'Early voting starts Monday.',
  follow_ups: {
    steps: [
      { message_text: 'Find your polling place: https://example.org/vote', wait: { unit: 'days', amount: 2 } },
      { message_text: 'Polls close at 7 tonight.', wait: { unit: 'hours', amount: 6 } },
    ],
    stop_on_reply: true,
    stop_on_click: true,
  },
  scheduled_timezone: 'America/Chicago',
  sequence_send_time: '09:00',
});
```

Email campaigns take follow-ups as `sequence` (`steps` of `template_id`, `delay_days`,
`send_time`, with `stop_on_reply` and `stop_on_click`); such a campaign reads
`type: 'broadcast'`. A triggered email campaign can have follow-ups too: beside a `trigger`,
each person's follow-up goes `delay_days` (1 to 365) after the calendar day their own previous
email was sent, in the campaign's `timezone`; email follow-ups wait whole days.

## Tags

A tag labels a contact (a phone number or an email address) inside one organization.
Manual tags have members you add and remove; activity tags (`donated`, `clicked`,
`responded`, `sent`, optionally within the last `within_days` days) apply by themselves
and are evaluated when a send compiles.

The simplest way to tag is by name: `tagContacts` finds the manual tag with that name
(ignoring case) or creates it, and `created` says which happened, so a misspelled name
that made a new tag is easy to catch. `untagContacts` takes the same body and never
creates a tag. Sends refer to tags by id, so keep the returned `tag.id`.

Tagging by `identifiers` answers with counts (`added` or `removed`, `invalid`). Tagging a
whole list by `contact_list_id` runs in the background: the call answers 202 with
`{ queued: true, job_id }` and no counts (by name, the `tag` and `created` too, since the
tag is created immediately). There is no job status endpoint; the outcome shows as the
tag's `member_count` on `listTags` once the job finishes. Narrow the result on `queued`.

```ts
const { data: tagged } = await client.tagContacts({ name: 'Volunteers', identifiers: ['(202) 555-0101', 'ada@example.org'] });
const tag = tagged.tag; // tagged.created is true when this call created it
const { data: job } = await client.addTagContacts(tag.id, { contact_list_id: listId }); // every active phone and subscribed address
if (job.queued) console.log(job.job_id); // a list is tagged in the background: no counts
const { data: donors } = await client.createTag({ activity_event: 'donated', within_days: 90 });

await client.createProject({
  ...projectSetup, // organization_id, name, protocol, message_text, phone_number_ids, brand_id, campaign_id
  contact_list_ids: [listId],
  tag_ids: [tag.id],               // also send to contacts carrying ANY of these
  require_tag_ids: [donors.id],    // keep only contacts carrying ALL of these
  suppression_tag_ids: [staffTagId], // leave these out of this send
});
```

`createProject` and `updateProject` (broadcast and survey projects alike) and
`createEmailCampaign` take the three tag fields; a campaign needs `list_ids` or `tag_ids`. A tagged contact is only sent to through a list
row the sender can use: a tagged phone must be on a live list the project's sender can use
(unscoped, or scoped to the project's own brand, toll-free number, or short code), and a
tagged address must be subscribed on a list the sending domain can use. Opt-outs and
unsubscribes always apply. `importContactList` can tag an `audience` import with
`tag_ids`, `tag_names`, or `tags_column`. `deleteTag`, `removeTagContacts`, and `untagContacts` need the
`public:delete` permission; a 409 `TAG_IN_USE` from `deleteTag` lists the live sends using
the tag in `error.body.details` (`TagInUseDetails`).

## Webhook endpoints

`listWebhookEndpoints` and `getWebhookEndpoint` read the outbound webhook endpoints of your
organization. They are read-only: endpoints and their signing secret are created and edited
in the dashboard. Use them to check delivery health from a script. `failing_since` is the
start of the current run of failed deliveries (`null` while healthy), and `disabled_reason`
is `consecutive_failures` when the platform switched an endpoint off after 3 days with no
successful delivery. Re-enabling the endpoint clears both. The list is keyset paginated:
page until `next_cursor` is null. The API key needs the `public:read` permission.

```ts
const { data: page } = await client.listWebhookEndpoints({ limit: 100 });
for (const endpoint of page.data) {
  if (!endpoint.enabled || endpoint.failing_since) console.log(endpoint.name, endpoint.disabled_reason);
}
```

## Conversations

A conversation is one thread between one of your sending numbers and one
contact, created by a project send. The API never creates a conversation; it
replies inside an existing one, from the same number, on the same project.
`listConversations` and `listConversationMessages` are keyset paginated like
the email endpoints.

```ts
// Reply to an inbound message.message.replied webhook.
await client.replyToConversation(conversationId, { text: 'Thanks for reaching out!' }, {
  idempotencyKey: 'reply-' + messageId,
});

// Reply with an image or video from the media library (one flat-rate MMS).
await client.replyToConversation(conversationId, { text: 'Here is the flyer', media_ids: [mediaId] });

// Recover inbound messages missed while a webhook endpoint was down.
const { data: page } = await client.listConversations({ updated_since: lastSeenAt });
for (const conversation of page.data) console.log(conversation.conversation_id, conversation.status);
```

## Email

The `/v1/email` surface is wrapped in full: sending domains, sender identities,
suppressions, templates, and campaigns. Paid
and human-driven workflows (AI drafting, result exports) run in the dashboard.
**Write methods need the email entitlement on the organization and return
`403 ENTITLEMENT_REQUIRED` without it. Reads are open.**

Email endpoints are keyset paginated: the payload is
`{ data, has_more, next_cursor }`. Page until `next_cursor` is null, and never
parse or construct a cursor.

There is no inbound email or inbox surface, and no A/B testing.

```ts
// Page through campaigns.
let cursor: string | undefined;
do {
  const page = await client.listEmailCampaigns({ limit: 100, cursor });
  for (const campaign of page.data!.data) console.log(campaign.name, campaign.status);
  cursor = page.data!.next_cursor ?? undefined;
} while (cursor);

// Check what is blocking a campaign before scheduling it.
const { data: campaign } = await client.getEmailCampaign(id);
if (campaign?.blocked?.length) {
  for (const reason of campaign.blocked) console.log(reason.code, reason.message);
} else {
  await client.scheduleEmailCampaign(id, { scheduled_at: '2026-09-05T15:00:00Z' });
}
```

### Pause and resume

`pauseEmailCampaign(id)` pauses a `scheduled`, `compiling`, or `sending` campaign
with `pause_reason: 'api'`; the platform never resumes an `api` pause by itself.
`resumeEmailCampaign(id, { resume_at })` resumes it now, or with a `resume_at`
more than a minute ahead keeps it paused and resumes it at that time (the
campaign's `resume_at` shows the plan; a later pause cancels it). Resume clears
any pause reason, but if the cause still holds the platform pauses it again.
Only `api`, `manual`, and `provider_refused` pauses wait for a person; the rest
resume on their own once the cause clears. Resume returns `409 SENDING_PAUSED`
while sending is suspended, and `409 EMAIL_CAMPAIGN_TEST_REQUIRED` when content
changed during the pause (send a test from the dashboard, then resume).

```ts
await client.pauseEmailCampaign(id);
await client.resumeEmailCampaign(id); // now
await client.resumeEmailCampaign(id, { resume_at: '2026-12-01T15:00:00Z' }); // planned
```

### Templates

Templates save the HTML a campaign sends. Create also returns `lint`: the save
succeeds either way, but a campaign will not schedule while `lint.errors` is
non-empty, so check it at save time rather than at send time. This endpoint
only accepts HTML content; `content.editor` is `'html'` for a template
created here, or `'document'` for one built in the dashboard's document
editor, readable over the API as rendered HTML only. Updating the `content`
of a `'document'` template returns `409 CONFLICT` with `details.reason` set
to `'TEMPLATE_IS_DOCUMENT'`.

### List imports

`importContactList` is the one list import, for phones, emails, or both. The
server fetches a CSV you host over https (50 MB cap) and returns 202. Name the
columns: `phone_column`, `email_column`, or both (there is no automatic email
column detection). `consent` is optional and allowed only for an `audience` list with emails; with `merge_tags`, phones map only the named columns while emails also map every remaining column.
`purpose: 'do_not_contact'` turns phones into an opt-out list and emails into
unsubscribes, and returns no `list_id`. For an audience import, poll `getContactList(id)`: `import` is the
phone side and `email.status` is the email side.

```ts
const { data: started } = await client.importContactList({
  source_url: 'https://example.com/donors.csv',
  list_name: 'August donors',
  phone_column: 'Phone',
  email_column: 'Email',
  merge_tags: { first_name: 'First Name' },
  consent: { source: 'donation_form', note: 'ActBlue donors, 2026 cycle' },
});
if (started.purpose === 'audience') console.log(started.list_id, started.channels);
```

`listContactLists` returns the lists that hold phone numbers by default; pass
`channel: 'email'` or `channel: 'all'` for the others. Each list reports its
`channels` and its `email` side (null when it has none). When `getContactList` reports `import.status` or `email.status` `failed`, that side's `error` (`{ code, message }`, null otherwise) says why; the message is safe to show an end user. `deleteContactList` removes a list's phone numbers and its emails.

API key permissions follow the HTTP method: GET needs `public:read`; POST, PATCH, and PUT need `public:write`; DELETE needs `public:write` and `public:delete`. A write-only key can create and change things but cannot read. The delete methods (`deleteContactList`, `deleteMedia`, `deleteTag`, `removeTagContacts`, `untagContacts`, `removeEmailSuppressions`) therefore need `public:delete`, which is opt-in when the key is created; other keys get a 403.

Email addresses reach a list only through `importContactList` with `email_column`
(a CSV import creates the list, with the email side). Poll `getContactList` and
read `email.status` and `email.counts`; read unsubscribes and bounces with
`listEmailSuppressions`.

## Error handling

Non-success responses throw `PoliticalCommsError` with the API's machine readable `code`, the HTTP `statusCode`, and the raw response `body`.

```ts
import { PoliticalCommsError } from '@political-comms/sdk';

try {
  await client.getProject('proj_unknown');
} catch (err) {
  if (err instanceof PoliticalCommsError) {
    console.error(err.code, err.statusCode, err.message);
  }
}
```

Network failures throw `PoliticalCommsError` with `code: 'NETWORK_ERROR'` and `statusCode: 0`.

## Retries

The client retries automatically with these rules:

- `400`, `401`, `403`, `404` are never retried.
- `429` is retried after waiting until the `X-RateLimit-Reset` timestamp.
- `500`, `502`, `503`, `504` are retried with exponential backoff and jitter: 1 second base, 60 second cap, at most 5 attempts total.

Configure the retry budget with `maxRetries` (retries after the first attempt, default 4):

```ts
const client = new PoliticalCommsClient({ maxRetries: 2 });
```

Every `POST` and `PATCH` request carries an `Idempotency-Key` header (a random UUID) so retries are safe; the API returns the cached first response when a key is replayed. `DELETE` requests send the header only when you supply a key. Supply your own key per call when you need cross-process deduplication:

```ts
await client.createProject(body, { idempotencyKey: 'send-2026-11-03-wave-1' });
```

Each call also accepts an `AbortSignal`:

```ts
await client.listProjects({}, { signal: AbortSignal.timeout(10_000) });
```

## Rate limits

The API allows 600 requests per minute per key: bursts of up to 600 at once, refilling at 10 per second, the same for every scope. The client exposes the most recent rate limit headers:

```ts
await client.listOrganizations();
console.log(client.lastRateLimit);
// { limit: 100, remaining: 97, reset: 1767225600 }  (reset is Unix seconds)
```

## License

MIT. Questions: support@politicalcomms.com
