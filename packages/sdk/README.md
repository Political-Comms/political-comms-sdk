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
  // Optional. Brands T-Mobile meters (Aegis-vetted) pause at their daily
  // T-Mobile cap and must be started again each day; set this to run the whole
  // project through instead, accepting that over-limit messages to T-Mobile
  // recipients may fail and are still billed. Defaults to false.
  // daily_cap_bypass: true,
});
```

One method exists per API operation, named after its `operationId`: `listOrganizations`, `getHierarchy`, `listBrands`, `listCampaigns`, `listTrackingDomains`, `listPhoneNumbers`, `listTollFreeVerifications`, `getTollFreeVerification`, `listContactLists`, `getContactList`, `importContactList`, `analyzeContactList`, `deleteContactList`, `listMedia`, `importMedia`, `getMedia`, `deleteMedia`, `listProjects`, `createProject`, `getAllProjectStats`, `getProject`, `updateProject`, `getProjectStats`, `testProject`, `scheduleProject`, `unscheduleProject`, `copyProject`, `archiveProject`, `getMessageStats`, `getLedgerUsage`, `getLedgerUsageByInitiator`.

## Email (early access)

The `/v1/email` surface is wrapped in full: sending domains, sender identities,
lists and contacts, list imports, suppressions, templates, AI drafts, and
campaigns. **Every email method returns `403 EMAIL_EARLY_ACCESS` until the
email product reaches general availability.**
The contract is stable, so integrations can be written against it now.

Email lists are keyset paginated: the payload is
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

### Templates and AI drafts

Templates save the HTML a campaign sends. Create and update also return `lint`:
the save succeeds either way, but a campaign will not schedule while
`lint.errors` is non-empty, so check it at save time rather than at send time.
`content.editor` is always `'html'`; the designer document is not exposed.

Drafting is asynchronous and **costs money**: one `email_ai_draft` charge
($3.00 by default, per-org pricing) is recorded only when a draft reaches
`ready`. A failed draft is never billed, and a wallet that cannot cover the
draft up front is refused with `402 INSUFFICIENT_BALANCE` before any draft row
is created.

```ts
// Images must be email assets in the same organization.
const { data: asset } = await client.importMedia({
  source_url: 'https://example.com/header.png',
  organization_id: 'org_1',
  usage: 'email_asset', // brand_id must be omitted: email assets are org-scoped
});

const { data: requested } = await client.requestEmailTemplateDraft({
  prompt: 'A get-out-the-vote email for Tuesday, warm and urgent.',
  image_media_ids: [asset.media_id!],
  brand_colors: { primary: '#1a3d7c' },
});

// Generation runs on a queue, so the API is poll-based. This helper does the
// polling; a failed draft is returned, not thrown.
const draft = await client.waitForEmailTemplateDraft(requested.draft.id);
if (draft.status === 'ready') {
  await client.createEmailTemplate({
    name: 'GOTV Tuesday',
    content: { subject: draft.subject!, html: draft.html! },
  });
} else {
  console.error(draft.error_code, draft.error_message);
}
```

### List imports

`startEmailListImport` fetches a CSV you host over https (50 MB cap) and commits
it in one call. Omit `mapping` to let the server recognize a common ESP export;
when neither your mapping nor the recognizer finds an email column the call is a
`400 VALIDATION_ERROR` whose `details.headers` lists the headers that were read,
so you can retry with a mapping instead of guessing.

```ts
const { data: started } = await client.startEmailListImport({
  source_url: 'https://example.com/donors.csv',
  email_list_id: 'lst_1',
  consent: { source: 'donation_form', note: 'ActBlue donors, 2026 cycle' },
});
const { data: imported } = await client.getEmailListImport(started.id);
console.log(imported.status, imported.summary);
```

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

The API allows, per key over a 60-second sliding window, 100 requests/minute for reads, 60/minute for writes, and 30/minute for deletes. The client exposes the most recent rate limit headers:

```ts
await client.listOrganizations();
console.log(client.lastRateLimit);
// { limit: 100, remaining: 97, reset: 1767225600 }  (reset is Unix seconds)
```

## License

MIT. Questions: support@politicalcomms.com
