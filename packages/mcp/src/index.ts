import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  PoliticalCommsClient,
  PoliticalCommsError,
  type ContactListConsentSource,
  type ContactListImportPurpose,
  type ListContactListsQuery,
  type CreateProjectRequest,
  type MergeTagMapping,
  type Trigger,
  type ScheduleTimezone,
} from '@political-comms/sdk';

const SERVER_INSTRUCTIONS =
  'Political Comms is a direct-to-carrier political texting platform for US campaigns, PACs, ' +
  'advocacy organizations, fundraisers, and elected officials. Use these tools to inspect ' +
  'organizations, projects, contact lists, analytics, and billing, and to create, test, and ' +
  'schedule compliant political SMS and MMS sends. An API key is required via the ' +
  'POLITICAL_COMMS_API_KEY environment variable (created in the dashboard under Admin > API). ' +
  'The write tools create_project, test_project, schedule_project, start_project, ' +
  'add_project_recipient, reply_to_conversation, schedule_email_campaign, ' +
  'resume_email_campaign, add_email_campaign_recipient, and import_contact_list ' +
  'send real messages, spend money, or write contacts, and require ' +
  'confirm: true. Rate limit per key: 600 requests/minute, bursts up to 600, refilling 10 per second. ' +
  'The email write tools need the email entitlement on the organization and return ' +
  '403 ENTITLEMENT_REQUIRED without it; email reads are open. ' +
  'There is no inbound email or inbox surface.';

// JSON Schema fragments reused across tools.
/** Cap on CSV text returned to the model in one tool result. */
const DOWNLOAD_MAX_CHARS = 100_000;

const idParam = { type: 'string', description: 'Resource ID' } as const;
const orgFilter = { type: 'string', description: 'Filter to a specific descendant organization' } as const;
const brandFilter = { type: 'string', description: 'Filter to a specific brand' } as const;
const campaignFilter = { type: 'string', description: 'Filter to a specific campaign' } as const;
const startDateParam = { type: 'string', description: 'Start date in YYYY-MM-DD format' } as const;
const endDateParam = { type: 'string', description: 'End date in YYYY-MM-DD format' } as const;
const confirmParam = {
  type: 'boolean',
  description:
    'Must be true to run this write operation. Set it only after the user has explicitly confirmed.',
} as const;

const triggerParam = {
  type: 'object',
  description:
    'When a triggered project or campaign adds a recipient. source "api": recipients arrive from ' +
    'add_project_recipient / add_email_campaign_recipient or the inbound hook URL. source "donation": ' +
    'a gift from a connected WinRed or Anedot list (donation.integrations is required). source "event": ' +
    'something that happens in another project or campaign (event.event and event.sources are required). ' +
    'delay_minutes (0-43200) delays each send; reentry is {mode: "once"} (default) or ' +
    '{mode: "repeat", min_gap_hours: 1-8760}.',
  properties: {
    source: { type: 'string', enum: ['api', 'donation', 'event'] },
    delay_minutes: { type: 'number', minimum: 0, maximum: 43200 },
    reentry: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['once', 'repeat'] },
        min_gap_hours: { type: 'number', minimum: 1, maximum: 8760, description: 'Required with mode repeat' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    donation: {
      type: 'object',
      description: 'Required when source is donation',
      properties: {
        integrations: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['winred', 'anedot'] },
              id: { type: 'string', description: 'Integration ID' },
            },
            required: ['provider', 'id'],
            additionalProperties: false,
          },
        },
        donor: { type: 'string', enum: ['any', 'first_time', 'returning'], description: 'Default any' },
        gift: { type: 'string', enum: ['any', 'one_time', 'recurring'], description: 'Default any' },
        amount_min: { type: ['number', 'null'], description: 'Dollars, inclusive' },
        amount_max: { type: ['number', 'null'], description: 'Dollars, inclusive' },
        page_names: { type: 'array', items: { type: 'string' } },
        source_codes: { type: 'array', items: { type: 'string' } },
      },
      required: ['integrations'],
      additionalProperties: false,
    },
    event: {
      type: 'object',
      description: 'Required when source is event',
      properties: {
        event: {
          type: 'string',
          enum: ['text_link_click', 'text_reply', 'email_open', 'email_click', 'email_reply'],
        },
        sources: {
          description:
            '"any" (never includes another triggered item) or {ids: [...]}: project IDs for text_* ' +
            'events, email campaign IDs for email_* events',
          anyOf: [
            { type: 'string', enum: ['any'] },
            {
              type: 'object',
              properties: { ids: { type: 'array', items: { type: 'string' } } },
              required: ['ids'],
              additionalProperties: false,
            },
          ],
        },
        link_url: { type: 'string', description: 'email_click only' },
      },
      required: ['event', 'sources'],
      additionalProperties: false,
    },
  },
  required: ['source'],
  additionalProperties: false,
} as const;

const recipientFields = {
  type: 'object',
  description:
    'Optional merge-tag values for this recipient (up to 50 keys, scalar values). They are stored on ' +
    'the recipient and appear in reports, exports, and webhook contact.custom_fields.',
  additionalProperties: { type: ['string', 'number', 'boolean'] },
} as const;

const occurrenceIdParam = {
  type: 'string',
  maxLength: 128,
  description: 'Your id for the event, so a retry of the same event is a no-op',
} as const;

const emailLimit = {
  type: 'number',
  description: 'Rows per page, 1-200. Defaults to 50.',
} as const;

const emailCursor = {
  type: 'string',
  description:
    'Opaque cursor from the previous page next_cursor. Page until next_cursor is null; never parse a cursor.',
} as const;

const emailSearch = {
  type: 'string',
  description: 'Case-insensitive substring match.',
} as const;

const TOOLS: Tool[] = [
  {
    name: 'list_organizations',
    description:
      'List all organizations visible to the API key, including their status and parent organization. ' +
      'Also useful as a credential check.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List Organizations', readOnlyHint: true },
  },
  {
    name: 'get_hierarchy',
    description:
      'Get the full organization hierarchy tree visible to the API key, including nested child ' +
      'organizations and their brands.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: orgFilter },
      additionalProperties: false,
    },
    annotations: { title: 'Get Hierarchy', readOnlyHint: true },
  },
  {
    name: 'list_projects',
    description:
      'List messaging projects (a project is one composed send: message text, sending numbers, and ' +
      'contact lists). Optionally filter by organization, brand, or campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: orgFilter,
        brand_id: brandFilter,
        campaign_id: campaignFilter,
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Projects', readOnlyHint: true },
  },
  {
    name: 'get_project',
    description:
      'Get one project by ID with its full configuration: status, channel, message text, phone ' +
      'numbers, contact lists, link tracking settings, and schedule.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Project', readOnlyHint: true },
  },
  {
    name: 'get_project_throughput',
    description:
      'Estimate how carrier limits will affect one project before or during a send: recipients on ' +
      'T-Mobile and AT&T, the brand T-Mobile daily cap (counted in message parts, like AT&T; `will_pause` is always false and `estimated_send_days` is always 1, kept for compatibility), and AT&T minutes (`att.tpm` is in message parts per minute; the estimate is the minutes AT&T needs for what the campaign already has waiting plus the AT&T recipients in this project, accounting for the parts in the project text). A political brand with an AT&T rate returns `carrier_metered: true` with `t_mobile` null. ' +
      'Nulls mean not known right now, never zero. ' +
      'Past the cap, T-Mobile recipients send at a reduced rate and only a carrier rejection pauses a project. Results are ' +
      'cached up to 60 seconds; a timed-out estimate returns 503 `CARRIER_ESTIMATE_TIMEOUT` (retry later). ' +
      'A project paused with `pause_reason` `brand_daily_cap` resumes with `schedule_project` (it accepts ' +
      'paused projects): schedule it for the next day during sending hours (8 AM to 10 PM in the time zone of most ' +
      'recipients, or 8 AM Eastern to 10 PM Pacific when no zone holds a majority) with a morning `scheduled_at`, or call without one to try T-Mobile again at the reduced rate (it pauses ' +
      'again if T-Mobile is still rejecting; rejected messages are still billed). Never resume at midnight. Past the cap, other carriers are never slowed and ' +
      'T-Mobile plus unknown-carrier recipients send at a reduced rate; analyzing the list first means only T-Mobile is affected. ' +
      '`quiet_hours` pauses (at the window close: 10 PM in the time zone of most recipients, or 10 PM Pacific when no zone holds a majority) need a manual restart once the window opens.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Project Throughput', readOnlyHint: true },
  },
  {
    name: 'get_campaign_throughput',
    description:
      'Get a 10DLC campaign brand carrier limits: the T-Mobile daily cap, how much is used today ' +
      '(Pacific day), and the AT&T per-minute SMS and MMS rates (SMS counted in message parts, so a two-part text counts twice). The lanes are independent: `t_mobile` ' +
      'is null when the brand has no T-Mobile daily limit on file, `att` is null only when the campaign has no ' +
      'AT&T rate on file, and `carrier_metered` is true if either applies (political brands with an AT&T rate ' +
      'return true with `t_mobile` null). Both null means neither applies. Nulls inside mean not known right now, never zero.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Campaign Throughput', readOnlyHint: true },
  },
  {
    name: 'get_project_stats',
    description:
      'Get delivery and engagement stats for one project: sent, delivered, undeliverable, replies, ' +
      'opt outs, clicks, and the derived rates. The response also carries a `test` object with ' +
      'test-send activity tracked separately from the production metrics.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Project Stats', readOnlyHint: true },
  },
  {
    name: 'get_project_survey_results',
    description:
      'Get topline survey results for one project: per-question option counts and percentages, the ' +
      'unmatched or open-ended "other" bucket, and overall completion and dropoff rates. Only works for ' +
      'survey projects; any other project returns a 409 NOT_A_SURVEY error.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Project Survey Results', readOnlyHint: true },
  },
  {
    name: 'list_contact_lists',
    description:
      'List contact lists. Each list reports its channels (text, email). Optionally filter by ' +
      'organization, brand, or channel.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: orgFilter,
        brand_id: brandFilter,
        channel: {
          type: 'string',
          enum: ['text', 'email', 'all'],
          description: 'text (the default) lists the lists that hold phone numbers, email the ones that hold addresses, all both.',
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Contact Lists', readOnlyHint: true },
  },
  {
    name: 'get_contact_list',
    description:
      'Get one contact list by ID, including its available merge tags, phone import progress (import), email side status and counts (email), and list analysis results when available.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Contact List', readOnlyHint: true },
  },
  {
    name: 'download_contact_list',
    description:
      'Download a contact list as CSV text. `type` is `original` (phone number, original row, custom ' +
      'fields) or `analyzed` (adds phone type, carrier, mobile, opted-out, city, state; a 409 ' +
      '`ANALYSIS_NOT_COMPLETE` until `get_contact_list` shows `analysis.status` `complete`). Output is ' +
      `truncated at ${DOWNLOAD_MAX_CHARS.toLocaleString('en-US')} characters with a note; for a full ` +
      'file use the `downloads` URLs from `get_contact_list` with your API key.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam, type: { type: 'string', enum: ['original', 'analyzed'], description: 'Which file to download.' } },
      required: ['id', 'type'],
      additionalProperties: false,
    },
    annotations: { title: 'Download Contact List CSV', readOnlyHint: true },
  },
  {
    name: 'get_message_stats',
    description:
      'Get aggregate message stats (totals and daily breakdown) for a date range, optionally ' +
      'filtered by organization, brand, or campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: startDateParam,
        end_date: endDateParam,
        organization_id: orgFilter,
        brand_id: brandFilter,
        campaign_id: campaignFilter,
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Message Stats', readOnlyHint: true },
  },
  {
    name: 'get_ledger_usage',
    description:
      'Get billing usage totals and per-category breakdown from the ledger for a date range, ' +
      'optionally filtered to a descendant organization.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: startDateParam,
        end_date: endDateParam,
        organization_id: orgFilter,
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Ledger Usage', readOnlyHint: true },
  },
  {
    name: 'create_project',
    description:
      'Create a new messaging project (a draft send). Requires the owning organization, a name, ' +
      'protocol (sms or mms), sending phone number IDs, contact list IDs, and the message text. ' +
      'For a triggered project (no contact list; each recipient gets one message when the trigger ' +
      'fires) pass type "triggered" and a trigger instead of contact_list_ids; start it with ' +
      'start_project after test_project. ' +
      'For channel=10dlc also pass brand_id and campaign_id; for channel=toll-free pass ' +
      'toll_free_verification_id. Creating a project does not send messages by itself. A 409 ' +
      '`LIST_ANALYSIS_IN_PROGRESS` means a contact list is still being analyzed; wait until ' +
      '`get_contact_list` shows `analysis.status` `complete`, then retry.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        organization_id: { type: 'string', description: 'Owning organization ID' },
        type: {
          type: 'string',
          enum: ['broadcast', 'survey', 'triggered'],
          description: 'Project type. Defaults to broadcast. Triggered requires trigger and takes no list IDs.',
        },
        trigger: triggerParam,
        name: { type: 'string', description: 'Project name' },
        protocol: { type: 'string', enum: ['sms', 'mms'], description: 'Message protocol' },
        message_text: { type: 'string', description: 'The message body to send' },
        phone_number_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sending phone number IDs (1-49)',
        },
        contact_list_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Contact list IDs to send to. Required unless type is triggered.',
        },
        channel: {
          type: 'string',
          enum: ['10dlc', 'toll-free'],
          description: 'Messaging channel. Defaults to 10dlc.',
        },
        brand_id: { type: 'string', description: 'Required when channel=10dlc' },
        campaign_id: { type: 'string', description: 'Required when channel=10dlc' },
        toll_free_verification_id: { type: 'string', description: 'Required when channel=toll-free' },
        suppression_list_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Contact list IDs to suppress',
        },
        media_ids: { type: 'array', items: { type: 'string' }, description: 'Media file IDs for MMS' },
        link_tracking_enabled: { type: 'boolean', description: 'Enable link tracking' },
        link_tracking_destination_url: {
          type: 'string',
          description:
            'Destination URL for tracked links. May embed the selected link parameter via a ' +
            'placeholder named after it (e.g. ?utm_content=xyzd_{linkid}); without a placeholder ' +
            'the parameter is appended as its own query pair. May also be exactly ' +
            'https://{<link_tracking_param_field>} (e.g. https://{custom_url}) to send each ' +
            'recipient to the URL in that contact field; then link_tracking_fallback_url is required',
        },
        link_tracking_domain_id: { type: 'string', description: 'Tracking domain ID' },
        link_tracking_param_field: {
          type: 'string',
          description: 'Contact field carried on tracking-link redirects (phone or a custom-field name)',
        },
        link_tracking_fallback_url: {
          type: 'string',
          description:
            'Redirect for recipients whose link_tracking_param_field value is empty or not a valid ' +
            'URL. Required when link_tracking_destination_url is a whole-URL placeholder; rejected otherwise',
        },
        opt_out_footer_enabled: {
          type: 'boolean',
          description:
            'Whether the STOP=END opt-out footer is appended to every message (default true)',
        },
      },
      required: [
        'confirm',
        'organization_id',
        'name',
        'protocol',
        'message_text',
        'phone_number_ids',
      ],
      additionalProperties: false,
    },
    annotations: {
      title: 'Create Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'test_project',
    description:
      'Send real test messages for a project to up to 50 explicit phone numbers. This delivers ' +
      'actual SMS or MMS to those recipients and incurs cost. Numbers ending 555-0100 to 555-0199 are ' +
      'test phone numbers that never reach a phone and return a fixed outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        phones: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: 'Recipient phone numbers for the test send',
        },
        merge_values: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional merge-tag values, keyed by tag name, applied to every phone in this test send. ' +
            "When supplied, no contact is sampled from the project's lists; every tag renders from these " +
            'values with the normal fallback chain (inline fallback, then org default, then standard ' +
            'default, then empty) for any tag not present here. Omit to sample from the lists as usual.',
        },
      },
      required: ['confirm', 'id', 'phones'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Test Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'schedule_project',
    description:
      'Schedule a project to send to its full contact lists at a specific date and time. This ' +
      'commits a real bulk send to every contact on the lists once the scheduled time arrives. A 409 ' +
      '`LIST_ANALYSIS_IN_PROGRESS` means a contact list is still being analyzed; wait until ' +
      '`get_contact_list` shows `analysis.status` `complete`, then retry.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        scheduled_at: {
          type: 'string',
          description:
            'ISO 8601 date-time at which to send (with offset). May be now or in the past - ' +
            'sending starts as soon as audience compilation finishes (no minimum lead time).',
        },
        scheduled_timezone: {
          type: 'string',
          description: 'One of the six supported US IANA zones',
          enum: [
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Los_Angeles',
            'America/Anchorage',
            'Pacific/Honolulu',
          ],
        },
        daily_cap_bypass: {
          type: 'boolean',
          description:
            'Optional. Skip the reduced rate past the brand daily carrier limit and send T-Mobile ' +
            'recipients at full speed. Only applies to brands that have a T-Mobile daily limit on file (political brands have none today), ' +
            'whose T-Mobile recipients otherwise send at a reduced rate past the cap. ' +
            'A carrier rejection still pauses the project, and rejected messages are still billed. Defaults to false.',
        },
      },
      required: ['confirm', 'id', 'scheduled_at', 'scheduled_timezone'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Schedule Project',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: 'unschedule_project',
    description:
      'Remove the schedule from a project so it will not send. Safe to call repeatedly; the project ' +
      'returns to an unscheduled state.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Unschedule Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'pause_project',
    description:
      'Pause a project that is active, sending, or scheduled. Messages already handed to the carriers ' +
      'finish; everything else holds. Safe to call repeatedly: an already paused project returns its ' +
      'current pause_reason. Resume with schedule_project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idParam,
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'Optional short reason, returned as pause_reason on get_project. Defaults to manual.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Pause Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'start_project',
    description:
      'Start or resume a triggered project so it begins sending to recipients as its trigger fires. ' +
      'Test it first with test_project. This commits real sends. A 409 CONFLICT means the project ' +
      'is not triggered. Pause with pause_project.',
    inputSchema: {
      type: 'object',
      properties: { confirm: confirmParam, id: idParam },
      required: ['confirm', 'id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Start Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'end_project',
    description:
      'End a triggered project. This is final: recipients still waiting are not sent and the ' +
      'project cannot be restarted. A 409 CONFLICT means it is not triggered or was never started. ' +
      'Use pause_project to stop temporarily.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'End Project',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: 'add_project_recipient',
    description:
      'Add one recipient to an active triggered project. The person gets the project message, now or ' +
      'after its delay (held until 8 AM if it comes due between 10 PM and 8 AM their time). This sends ' +
      'a real text. Answers queued with send_at, or already_entered with a reason (duplicate, ' +
      'already_entered, too_soon). A paused project returns 409 CONFLICT; an opted-out number ' +
      'returns 409 CONTACT_OPTED_OUT.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        phone_number: { type: 'string', description: 'US phone number in +1 E.164 format' },
        fields: recipientFields,
        occurrence_id: occurrenceIdParam,
      },
      required: ['confirm', 'id', 'phone_number'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Add Project Recipient',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'create_project_hook',
    description:
      'Mint the inbound hook URL for a triggered project, for tools that can POST (Zapier, Make, n8n). ' +
      'The URL is shown only in this result, and any previous URL stops working at once.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Create Project Hook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: 'copy_project',
    description:
      'Copy an existing project into a new draft. The copy keeps the message, phone numbers, and ' +
      'settings but drops contact lists, schedule, and stats, and gets a versioned name (X becomes ' +
      'X_v2). Copying never sends messages.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'ID of the project to copy' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Copy Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  // -------------------------------------------------------------------------
  // Conversations. A conversation is one thread between one of the
  // organization's sending numbers and one contact, created by a project
  // send. The API never creates a conversation; it replies inside an
  // existing one, from the same number, on the same project.
  // -------------------------------------------------------------------------
  {
    name: 'list_conversations',
    description:
      'List conversations that have at least one inbound message, across every organization the ' +
      'key can access, sorted by last inbound message descending. Use this to recover inbound ' +
      'messages missed when a message.replied webhook endpoint was down: poll no more than once a ' +
      'minute, advancing updated_since to the newest last_inbound_at seen. There is no status ' +
      'filter; filter the results client side.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Filter to one project' },
        updated_since: {
          type: 'string',
          description:
            'ISO 8601 date-time. Filters on last_inbound_at. Defaults to now minus 7 days; more ' +
            'than 90 days back is rejected.',
        },
        include_test: { type: 'boolean', description: 'Include test conversations. Defaults to false.' },
        limit: { type: 'number', description: '1-200. Defaults to 50.' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from the previous page next_cursor. Never parse a cursor.',
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Conversations', readOnlyHint: true },
  },
  {
    name: 'get_conversation',
    description:
      'Get one conversation by ID: its status (active, inactive, or opted_out), the contact, message ' +
      'counts, and the last inbound/outbound timestamps.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Conversation', readOnlyHint: true },
  },
  {
    name: 'list_conversation_messages',
    description:
      'List the messages in one conversation, newest first. Reading never marks the thread read in ' +
      'the dashboard.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idParam,
        limit: { type: 'number', description: '1-200. Defaults to 50.' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from the previous page next_cursor. Never parse a cursor.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'List Conversation Messages', readOnlyHint: true },
  },
  {
    name: 'reply_to_conversation',
    description:
      'Send a real reply inside an existing conversation, from the same sending number, on the ' +
      'same project. This delivers an actual message to the contact and incurs cost. Send text ' +
      '(up to 10 SMS parts, or 1500 characters with media), one media_ids entry from the ' +
      'media library, or both; at least one ' +
      'of non-blank text or a media id is required. Without media it is an SMS billed per segment; ' +
      'with media it is one flat-rate MMS. A media id that is not usable returns MEDIA_NOT_USABLE ' +
      'and nothing is charged. Final delivery state arrives on the existing ' +
      'message.sent / message.delivered / message.failed webhooks.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        text: { type: 'string', maxLength: 1600, description: 'The reply text to send. Optional when media_ids is given' },
        media_ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 1,
          description: 'One media library id to send as MMS (see list_media)',
        },
      },
      required: ['confirm', 'id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Reply To Conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'list_webhook_endpoints',
    description:
      'List the organization outbound webhook endpoints, with health: enabled, failing_since ' +
      '(start of the current run of failed deliveries, null while healthy), and disabled_reason ' +
      '("consecutive_failures" when the platform switched it off after 3 days without a ' +
      'successful delivery). Read-only: endpoints and signing secrets are managed in the dashboard.',
    inputSchema: {
      type: 'object',
      properties: { limit: emailLimit, cursor: emailCursor },
      additionalProperties: false,
    },
    annotations: { title: 'List Webhook Endpoints', readOnlyHint: true },
  },
  {
    name: 'get_webhook_endpoint',
    description:
      'Get one webhook endpoint: URL, subscribed event types, enabled flag, and delivery health ' +
      '(failing_since, disabled_reason). The signing secret is never returned.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Webhook Endpoint', readOnlyHint: true },
  },
  // -------------------------------------------------------------------------
  // Email. Write tools need the email entitlement on the organization
  // (403 ENTITLEMENT_REQUIRED without it); reads are open.
  // -------------------------------------------------------------------------
  {
    name: 'list_email_domains',
    description:
      'List email sending domains and their DNS verification status. A domain is usable ' +
      'for sending only once status is "active".',
    inputSchema: {
      type: 'object',
      properties: { limit: emailLimit, cursor: emailCursor, search: emailSearch },
      additionalProperties: false,
    },
    annotations: { title: 'List Email Domains', readOnlyHint: true },
  },
  {
    name: 'get_email_domain',
    description:
      'Get one email sending domain, including the DNS records the customer must publish. ' +
      'DNS is manual: the platform never writes records.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Email Domain', readOnlyHint: true },
  },
  {
    name: 'list_email_senders',
    description:
      'List email sender identities (From addresses). An identity missing a required physical ' +
      'address or disclaimer is paused rather than allowed to send.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List Email Senders', readOnlyHint: true },
  },
  {
    name: 'list_email_suppressions',
    description:
      'List suppressed email addresses at organization, sender identity, or list scope.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: emailLimit,
        cursor: emailCursor,
        scope: {
          type: 'string',
          description: 'Suppression scope to filter by',
          enum: ['org', 'identity', 'list'],
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Email Suppressions', readOnlyHint: true },
  },
  {
    name: 'list_email_campaigns',
    description:
      'List email campaigns with their status and audience counts.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: emailLimit,
        cursor: emailCursor,
        search: emailSearch,
        status: {
          type: 'string',
          description: 'Filter by campaign status',
          enum: [
            'draft',
            'awaiting_test',
            'awaiting_approval',
            'ready',
            'scheduled',
            'compiling',
            'sending',
            'paused',
            'completed',
            'deleted',
          ],
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Email Campaigns', readOnlyHint: true },
  },
  {
    name: 'get_email_campaign',
    description:
      'Get one email campaign. This read also returns "blocked": the machine-readable list of ' +
      'reasons the campaign will not schedule yet. Check it before scheduling.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Email Campaign', readOnlyHint: true },
  },
  {
    name: 'get_email_campaign_stats',
    description:
      'Get report tiles and per-link click stats for an email campaign. ' +
      'Cached for 60 seconds. Test and seed sends are excluded from every figure.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Email Campaign Stats', readOnlyHint: true },
  },
  {
    name: 'schedule_email_campaign',
    description:
      'Schedule an email campaign, or omit scheduled_at to send now. This commits a real send to ' +
      'every recipient on the campaign lists. If it is refused, read "blocked" on the campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 date-time. Omit to send immediately. A past date is rejected.',
        },
      },
      required: ['confirm', 'id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Schedule Email Campaign',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'unschedule_email_campaign',
    description:
      'Remove the schedule from an email campaign, returning it to a draft state.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Unschedule Email Campaign',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'pause_email_campaign',
    description:
      'Pause a scheduled, compiling, or sending email campaign. Messages already handed off still ' +
      'deliver; nothing more is sent. The pause_reason is always api, and the platform never resumes ' +
      'an api pause by itself: resume with resume_email_campaign. Safe to call repeatedly: an already ' +
      'paused campaign returns its own pause_reason (which may be one the platform set) and any planned ' +
      'resume_at is cancelled. A 409 CONFLICT means the campaign is a draft, awaiting test or approval, ' +
      'ready, or completed. Works even while sending is suspended. Pausing an email in a sequence holds ' +
      'its follow-ups; a paused triggered campaign refuses new recipients.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Pause Email Campaign',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'resume_email_campaign',
    description:
      'Resume a paused email campaign. This sends real mail. Clears any pause reason and returns the ' +
      'campaign to the status it was paused from; if the cause still holds, the platform pauses it ' +
      'again (provider_refused after one more refused batch, balance or sender problems at the next ' +
      'batch). With resume_at more than a minute ahead the campaign stays paused and resumes at that ' +
      'time; resume_at is null otherwise, and a later pause_email_campaign cancels the plan. Only api, ' +
      'manual, and provider_refused pauses need this call; the others resume on their own once the cause ' +
      'clears. Errors: 409 SENDING_PAUSED (sending is suspended), 409 EMAIL_CAMPAIGN_TEST_REQUIRED ' +
      '(content changed during the pause: a human must send a test from the dashboard, then resume), ' +
      '409 CONFLICT (draft, awaiting test or approval, ready, or completed), 400 for a past resume_at. ' +
      'An already running campaign returns 200 unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        resume_at: {
          type: 'string',
          description:
            'ISO 8601 date-time (Z or offset) to resume at. Omit to resume now. More than a minute in the past is rejected.',
        },
      },
      required: ['confirm', 'id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Resume Email Campaign',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'end_email_campaign',
    description:
      'End a triggered email campaign. This is final: recipients still waiting are not sent. A 409 ' +
      'CONFLICT means it is not a triggered campaign that is sending or paused. To start a triggered ' +
      'campaign, call schedule_email_campaign without scheduled_at.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'End Email Campaign',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: 'add_email_campaign_recipient',
    description:
      'Add one recipient to a triggered email campaign. The person gets the campaign email, now or ' +
      'after its delay. This sends a real email. Answers queued with send_at, or already_entered with ' +
      'a reason (duplicate, already_entered, too_soon). A paused campaign returns 409 CONFLICT; a ' +
      'suppressed address returns 422 with the reason.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        email: { type: 'string', description: 'Recipient email address' },
        fields: recipientFields,
        occurrence_id: occurrenceIdParam,
      },
      required: ['confirm', 'id', 'email'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Add Email Campaign Recipient',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'create_email_campaign_hook',
    description:
      'Mint the inbound hook URL for a triggered email campaign, for tools that can POST (Zapier, ' +
      'Make, n8n). The URL is shown only in this result, and any previous URL stops working at once.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Create Email Campaign Hook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: 'list_email_templates',
    description:
      'List saved email templates with their subject line and last-updated time. The HTML body ' +
      'is returned by get_email_template, not by this list.',
    inputSchema: {
      type: 'object',
      properties: { limit: emailLimit, cursor: emailCursor, search: emailSearch },
      additionalProperties: false,
    },
    annotations: { title: 'List Email Templates', readOnlyHint: true },
  },
  {
    name: 'get_email_template',
    description:
      'Get one email template including its full HTML body, which can be large. "editor" is ' +
      '"html" for a template imported or hand-written as HTML, or "document" for one built in ' +
      'the dashboard\'s document editor; both are returned as rendered HTML here.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Email Template', readOnlyHint: true },
  },
  {
    name: 'import_contact_list',
    description:
      'Import a CSV of contacts as a new list of phones, emails, or both. The server fetches ' +
      'source_url over https (50 MB cap), so this changes who a project or email campaign will ' +
      'reach. Name phone_column, email_column, or both; there is no automatic email column ' +
      'detection. consent_source is optional and allowed only for an audience list with an email column. With merge_tags, phones map only the named columns while emails also map every remaining column. purpose ' +
      'do_not_contact turns phones into an opt-out list and emails into unsubscribes, and ' +
      'returns no list_id. Poll get_contact_list: import is the phone side and email.status is the email side. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        source_url: { type: 'string', description: 'https URL of the CSV file.' },
        list_name: { type: 'string', description: 'Name for the new list, 1-255 characters.' },
        organization_id: { type: 'string', description: 'Target organization. Defaults to the key owner.' },
        brand_id: { type: 'string', description: 'Scope the list to this brand.' },
        purpose: {
          type: 'string',
          enum: ['audience', 'do_not_contact'],
          description: 'audience (the default) makes a list you can send to; do_not_contact makes opt-outs and unsubscribes.',
        },
        phone_column: { type: 'string', description: 'CSV column that holds the phone number.' },
        email_column: { type: 'string', description: 'CSV column that holds the email address.' },
        merge_tags: {
          type: 'object',
          description:
            'Maps CSV columns to merge fields: first_name, last_name, address, address_line_2, city, ' +
            'state, zip (each a CSV column name), and custom_fields [{ csv_column, merge_tag }]. Omit ' +
            'it and every other column gets a merge tag automatically; with it, emails still map every remaining column by default name.',
        },
        consent_source: {
          type: 'string',
          description:
            'How the people in this file agreed to hear from you. Optional; allowed only for an audience list with an email column, refused otherwise.',
          enum: ['donation_form', 'petition', 'signup_form', 'event', 'purchased', 'rented', 'other'],
        },
        consent_note: { type: 'string', description: 'Optional detail about the consent, up to 1000 characters.' },
        email_domain_id: {
          type: 'string',
          description: 'Scope the emails to one sending domain. Omit for the whole organization.',
        },
        acquired: { type: 'boolean', description: 'Optional, default false. The emails were purchased or rented; the list is sent more gradually.' },
      },
      required: ['confirm', 'source_url', 'list_name'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Import Contact List',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];

const CONFIRM_REQUIRED = new Set([
  'create_project',
  'test_project',
  'schedule_project',
  // Sends a real SMS and spends money.
  'reply_to_conversation',
  'schedule_email_campaign',
  // Resuming sends the rest of the campaign.
  'resume_email_campaign',
  // Each of these sends to one person the moment it is called, or commits a triggered item to send.
  'start_project',
  'add_project_recipient',
  'add_email_campaign_recipient',
  // Writes contacts into a list, changing who a campaign reaches.
  'import_contact_list',
]);

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function recoveryHint(err: PoliticalCommsError): string {
  if (err.statusCode === 429) {
    return (
      'The API allows 600 requests per minute per key (bursts up to 600, refilling 10 per second). ' +
      'Wait until the time in the X-RateLimit-Reset header (Unix seconds) before retrying; ' +
      'the SDK already waited through its retry budget.'
    );
  }
  if (err.statusCode === 401) {
    return (
      'The API key is missing or invalid. A human must create a key in the Political Comms ' +
      'dashboard (Admin > API) and set it as the POLITICAL_COMMS_API_KEY environment variable ' +
      'for this MCP server.'
    );
  }
  if (err.code === 'ONBOARDING_INCOMPLETE') {
    return (
      'The organization has not finished required account setup (business profile or funding) ' +
      'within its 14-day grace window, so this create is blocked. A human must finish setup at ' +
      'the dashboard onboardingUrl in the error details before retrying.'
    );
  }
  if (err.code === 'ENTITLEMENT_REQUIRED') {
    return (
      'The organization is not entitled to this feature (see the entitlement key in the error ' +
      'details). This requires enablement by Political Comms; a human must contact support before ' +
      'retrying.'
    );
  }
  if (err.code === 'SENDING_PAUSED') {
    return (
      'Sending is paused for this organization or platform-wide (see scope in the error details), ' +
      'set by Political Comms. A human must confirm sending is resumed before retrying.'
    );
  }
  if (err.statusCode === 403) {
    return 'The API key does not have access to this resource or organization.';
  }
  if (err.statusCode === 404) {
    return 'The resource was not found. Verify the ID with the corresponding list tool.';
  }
  if (err.code === 'NETWORK_ERROR') {
    return 'The API could not be reached. Check network connectivity and try again.';
  }
  return 'See https://politicalcomms.com/errors.md for error code documentation.';
}

type Args = Record<string, unknown>;

function s(args: Args, key: string): string {
  return String(args[key]);
}

function opt(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : String(args[key]);
}

/** Numeric optional arg. `limit` must stay a number: the SDK sends it as a query value. */
function optNum(args: Args, key: string): number | undefined {
  return args[key] === undefined ? undefined : Number(args[key]);
}

function createProjectRequest(args: Args): CreateProjectRequest {
  const base = {
    organization_id: s(args, 'organization_id'),
    channel: opt(args, 'channel') as '10dlc' | 'toll-free' | undefined,
    brand_id: opt(args, 'brand_id'),
    campaign_id: opt(args, 'campaign_id'),
    toll_free_verification_id: opt(args, 'toll_free_verification_id'),
    phone_number_ids: (args.phone_number_ids as string[]) ?? [],
    name: s(args, 'name'),
    protocol: s(args, 'protocol') as 'sms' | 'mms',
    media_ids: args.media_ids as string[] | undefined,
    message_text: s(args, 'message_text'),
    link_tracking_enabled: args.link_tracking_enabled as boolean | undefined,
    link_tracking_destination_url: opt(args, 'link_tracking_destination_url'),
    link_tracking_domain_id: opt(args, 'link_tracking_domain_id'),
    link_tracking_param_field: opt(args, 'link_tracking_param_field'),
    link_tracking_fallback_url: opt(args, 'link_tracking_fallback_url'),
    opt_out_footer_enabled: args.opt_out_footer_enabled as boolean | undefined,
  };
  if (args.type === 'triggered') {
    return { ...base, type: 'triggered', trigger: args.trigger as Trigger };
  }
  return {
    ...base,
    type: opt(args, 'type') as 'broadcast' | 'survey' | undefined,
    contact_list_ids: (args.contact_list_ids as string[]) ?? [],
    suppression_list_ids: args.suppression_list_ids as string[] | undefined,
  };
}

async function callTool(client: PoliticalCommsClient, name: string, args: Args): Promise<CallToolResult> {
  switch (name) {
    case 'list_organizations':
      return textResult(await client.listOrganizations());
    case 'get_hierarchy':
      return textResult(await client.getHierarchy({ organizationId: opt(args, 'organization_id') }));
    case 'list_projects':
      return textResult(
        await client.listProjects({
          organization_id: opt(args, 'organization_id'),
          brand_id: opt(args, 'brand_id'),
          campaign_id: opt(args, 'campaign_id'),
        }),
      );
    case 'get_project':
      return textResult(await client.getProject(s(args, 'id')));
    case 'get_project_throughput':
      return textResult(await client.getProjectThroughput(s(args, 'id')));
    case 'get_campaign_throughput':
      return textResult(await client.getCampaignThroughput(s(args, 'id')));
    case 'get_project_stats':
      return textResult(await client.getProjectStats(s(args, 'id')));
    case 'get_project_survey_results':
      return textResult(await client.getProjectSurveyResults(s(args, 'id')));
    case 'list_contact_lists':
      return textResult(
        await client.listContactLists({
          organization_id: opt(args, 'organization_id'),
          brand_id: opt(args, 'brand_id'),
          channel: opt(args, 'channel') as ListContactListsQuery['channel'],
        }),
      );
    case 'get_contact_list':
      return textResult(await client.getContactList(s(args, 'id')));
    case 'download_contact_list': {
      const csv = await client.downloadContactList(s(args, 'id'), s(args, 'type') as 'original' | 'analyzed');
      const text =
        csv.length > DOWNLOAD_MAX_CHARS
          ? `${csv.slice(0, DOWNLOAD_MAX_CHARS)}\n[truncated: showing the first ${DOWNLOAD_MAX_CHARS} of ${csv.length} characters; fetch the full file from the downloads URL on get_contact_list]`
          : csv;
      return { content: [{ type: 'text', text }] };
    }
    case 'get_message_stats':
      return textResult(
        await client.getMessageStats({
          startDate: s(args, 'start_date'),
          endDate: s(args, 'end_date'),
          organizationId: opt(args, 'organization_id'),
          brandId: opt(args, 'brand_id'),
          campaignId: opt(args, 'campaign_id'),
        }),
      );
    case 'get_ledger_usage':
      return textResult(
        await client.getLedgerUsage({
          startDate: s(args, 'start_date'),
          endDate: s(args, 'end_date'),
          organizationId: opt(args, 'organization_id'),
        }),
      );
    case 'create_project':
      return textResult(await client.createProject(createProjectRequest(args)));
    case 'test_project': {
      const phones = (args.phones as string[]) ?? [];
      const mergeValues = args.merge_values as Record<string, string> | undefined;
      return textResult(
        await client.testProject(s(args, 'id'), {
          test_contacts: phones.map((phone) => (mergeValues ? { phone, merge_values: mergeValues } : { phone })),
        }),
      );
    }
    case 'schedule_project':
      return textResult(
        await client.scheduleProject(s(args, 'id'), {
          scheduled_at: s(args, 'scheduled_at'),
          // The tool inputSchema enum constrains the value; the server rejects
          // anything outside the six supported zones with a 400.
          scheduled_timezone: s(args, 'scheduled_timezone') as ScheduleTimezone,
          daily_cap_bypass: args.daily_cap_bypass as boolean | undefined,
        }),
      );
    case 'unschedule_project':
      return textResult(await client.unscheduleProject(s(args, 'id')));
    case 'pause_project': {
      const reason = opt(args, 'reason');
      return textResult(await client.pauseProject(s(args, 'id'), reason ? { reason } : undefined));
    }
    case 'start_project':
      return textResult(await client.startProject(s(args, 'id')));
    case 'end_project':
      return textResult(await client.endProject(s(args, 'id')));
    case 'add_project_recipient':
      return textResult(
        await client.addProjectRecipient(s(args, 'id'), {
          phone_number: s(args, 'phone_number'),
          fields: args.fields as Record<string, string | number | boolean> | undefined,
          occurrence_id: opt(args, 'occurrence_id'),
        }),
      );
    case 'create_project_hook':
      return textResult(await client.createProjectHook(s(args, 'id')));
    case 'copy_project':
      return textResult(await client.copyProject(s(args, 'project_id')));

    case 'list_conversations':
      return textResult(
        await client.listConversations({
          project_id: opt(args, 'project_id'),
          updated_since: opt(args, 'updated_since'),
          include_test: args.include_test as boolean | undefined,
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
        }),
      );
    case 'get_conversation':
      return textResult(await client.getConversation(s(args, 'id')));
    case 'list_conversation_messages':
      return textResult(
        await client.listConversationMessages(s(args, 'id'), {
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
        }),
      );
    case 'reply_to_conversation':
      return textResult(
        await client.replyToConversation(s(args, 'id'), {
          text: opt(args, 'text'),
          media_ids: args.media_ids as string[] | undefined,
        }),
      );

    case 'list_webhook_endpoints':
      return textResult(
        await client.listWebhookEndpoints({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
        }),
      );
    case 'get_webhook_endpoint':
      return textResult(await client.getWebhookEndpoint(s(args, 'id')));

    // Email.
    case 'list_email_domains':
      return textResult(
        await client.listEmailDomains({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
          search: opt(args, 'search'),
        }),
      );
    case 'get_email_domain':
      return textResult(await client.getEmailDomain(s(args, 'id')));
    case 'list_email_senders':
      return textResult(await client.listEmailSenders());
    case 'list_email_suppressions':
      return textResult(
        await client.listEmailSuppressions({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
          scope: opt(args, 'scope') as never,
        }),
      );
    case 'list_email_campaigns':
      return textResult(
        await client.listEmailCampaigns({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
          search: opt(args, 'search'),
          status: opt(args, 'status') as never,
        }),
      );
    case 'get_email_campaign':
      return textResult(await client.getEmailCampaign(s(args, 'id')));
    case 'get_email_campaign_stats':
      return textResult(await client.getEmailCampaignStats(s(args, 'id')));
    case 'schedule_email_campaign':
      return textResult(
        await client.scheduleEmailCampaign(s(args, 'id'), {
          ...(args.scheduled_at === undefined ? {} : { scheduled_at: s(args, 'scheduled_at') }),
        }),
      );
    case 'unschedule_email_campaign':
      return textResult(await client.unscheduleEmailCampaign(s(args, 'id')));
    case 'pause_email_campaign':
      return textResult(await client.pauseEmailCampaign(s(args, 'id')));
    case 'resume_email_campaign':
      return textResult(
        await client.resumeEmailCampaign(s(args, 'id'), {
          ...(args.resume_at === undefined ? {} : { resume_at: s(args, 'resume_at') }),
        }),
      );
    case 'end_email_campaign':
      return textResult(await client.endEmailCampaign(s(args, 'id')));
    case 'add_email_campaign_recipient':
      return textResult(
        await client.addEmailCampaignRecipient(s(args, 'id'), {
          email: s(args, 'email'),
          fields: args.fields as Record<string, string | number | boolean> | undefined,
          occurrence_id: opt(args, 'occurrence_id'),
        }),
      );
    case 'create_email_campaign_hook':
      return textResult(await client.createEmailCampaignHook(s(args, 'id')));
    case 'list_email_templates':
      return textResult(
        await client.listEmailTemplates({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
          search: opt(args, 'search'),
        }),
      );
    case 'get_email_template':
      return textResult(await client.getEmailTemplate(s(args, 'id')));
    case 'import_contact_list':
      return textResult(
        await client.importContactList({
          source_url: s(args, 'source_url'),
          list_name: s(args, 'list_name'),
          organization_id: opt(args, 'organization_id'),
          brand_id: opt(args, 'brand_id'),
          purpose: opt(args, 'purpose') as ContactListImportPurpose | undefined,
          phone_column: opt(args, 'phone_column'),
          email_column: opt(args, 'email_column'),
          merge_tags: args.merge_tags as MergeTagMapping | undefined,
          ...(args.consent_source === undefined
            ? {}
            : {
                consent: {
                  source: s(args, 'consent_source') as ContactListConsentSource,
                  ...(args.consent_note === undefined ? {} : { note: s(args, 'consent_note') }),
                },
              }),
          email_domain_id: opt(args, 'email_domain_id'),
          ...(args.acquired === undefined ? {} : { acquired: args.acquired === true }),
        }),
      );

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function start(): Promise<void> {
  const server = new Server(
    { name: 'political-comms', version: '0.22.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  // The SDK client is created lazily so tools/list works without an API key.
  let client: PoliticalCommsClient | null = null;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args: Args = (rawArgs as Args) ?? {};

    if (CONFIRM_REQUIRED.has(name) && args.confirm !== true) {
      return errorResult(
        `Refusing to run ${name}: it sends real messages, spends money, or writes contacts. ` +
          'Ask the user to confirm the exact action, then call the tool again with confirm: true.',
      );
    }

    try {
      client ??= new PoliticalCommsClient();
    } catch (cause) {
      return errorResult(
        (cause instanceof Error ? cause.message : String(cause)) +
          ' A human must create a key in the Political Comms dashboard (Admin > API) and set ' +
          'POLITICAL_COMMS_API_KEY in this MCP server configuration.',
      );
    }

    try {
      return await callTool(client, name, args);
    } catch (cause) {
      if (cause instanceof PoliticalCommsError) {
        return errorResult(
          `Political Comms API error ${cause.code} (HTTP ${cause.statusCode}): ${cause.message}. ` +
            recoveryHint(cause),
        );
      }
      return errorResult(cause instanceof Error ? cause.message : String(cause));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
