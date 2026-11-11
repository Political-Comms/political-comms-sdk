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

One method exists per API operation, named after its `operationId`: `listOrganizations`, `getHierarchy`, `listBrands`, `listCampaigns`, `getCampaignThroughput`, `listTrackingDomains`, `listPhoneNumbers`, `listTollFreeVerifications`, `getTollFreeVerification`, `listContactLists`, `getContactList`, `importContactList`, `analyzeContactList`, `downloadContactList`, `deleteContactList`, `listMedia`, `importMedia`, `getMedia`, `deleteMedia`, `listProjects`, `createProject`, `getAllProjectStats`, `getProject`, `updateProject`, `getProjectStats`, `getProjectSurveyResults`, `getProjectThroughput`, `testProject`, `scheduleProject`, `unscheduleProject`, `pauseProject`, `copyProject`, `listConversations`, `getConversation`, `listConversationMessages`, `replyToConversation`, `getMessageStats`, `getLedgerUsage`, `getLedgerUsageByInitiator`.

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
and human-driven workflows (AI drafting, result exports) and
deliverability triage (pausing a live send) run in the dashboard.
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
`channels` and its `email` side (null when it has none). `deleteContactList` removes a list's phone numbers and its emails.

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
