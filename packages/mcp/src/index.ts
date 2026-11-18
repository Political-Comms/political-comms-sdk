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
  type CreateTagRequest,
  type MergeTagMapping,
  type TagActivityEvent,
  type AddTagContactsRequest,
  type ProjectFollowUps,
  type CreateSurveyProjectRequest,
  type SurveyQuestionInput,
  type TagContactsRequest,
  type Trigger,
  type TriggerAudience,
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
  'resume_email_campaign, add_email_campaign_recipient, add_tag_contacts, and import_contact_list ' +
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
    'source "tag": a contact was newly tagged with one of tag.tag_ids (manual tags from list_tags); a ' +
    'tagged phone enters a text project, a tagged email address an email campaign, and re-tagging never ' +
    'fires. Each phone number or email address is sent a triggered item at most once. start "immediate" ' +
    '(default) sends after delay_minutes (0-43200); start "next_day" sends the day after the trigger ' +
    'fired at sequence_send_time in the project time zone, with delay_minutes 0.',
  properties: {
    source: { type: 'string', enum: ['api', 'donation', 'event', 'tag'] },
    start: { type: 'string', enum: ['immediate', 'next_day'], description: 'Default immediate' },
    delay_minutes: { type: 'number', minimum: 0, maximum: 43200, description: 'Must be 0 with start next_day' },
    tag: {
      type: 'object',
      description: 'Required when source is tag',
      properties: {
        tag_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Manual tag IDs' },
      },
      required: ['tag_ids'],
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

const scheduleTimezoneParam = {
  type: 'string',
  enum: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
} as const;

const audienceParam = {
  type: 'string',
  enum: ['current_and_new', 'new_only'],
  description:
    'Tag triggers only, required on the first start: current_and_new also sends to everyone carrying the ' +
    'tag now, new_only only to contacts tagged from now on. Ask the user which; refused for anything else.',
} as const;

const followUpsParam = {
  type: 'object',
  description:
    'Up to 9 follow-up texts after the first message (broadcast or triggered projects; a survey refuses ' +
    'them). Each step waits {unit: "days", amount: 1-365}, sent at sequence_send_time in ' +
    'scheduled_timezone (both then required), or {unit: "hours", amount: 1-72}; quiet hours only move a ' +
    'step later. A person stops getting them on a reply (stop_on_reply), a tracked-link click ' +
    '(stop_on_click), or an opt-out (always); at least one of the two flags must be true. A person whose ' +
    'first message failed gets none. Each follow-up is charged when it sends. Locked once the project starts.',
  properties: {
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 9,
      items: {
        type: 'object',
        properties: {
          message_text: { type: 'string' },
          media_ids: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'MMS projects only' },
          wait: {
            type: 'object',
            properties: {
              unit: { type: 'string', enum: ['days', 'hours'] },
              amount: { type: 'number', minimum: 1, maximum: 365, description: 'Days 1-365, hours 1-72' },
            },
            required: ['unit', 'amount'],
            additionalProperties: false,
          },
        },
        required: ['message_text', 'wait'],
        additionalProperties: false,
      },
    },
    stop_on_reply: { type: 'boolean' },
    stop_on_click: { type: 'boolean' },
  },
  required: ['steps', 'stop_on_reply', 'stop_on_click'],
  additionalProperties: false,
} as const;

const sequenceNumber = { type: 'integer', minimum: 1, maximum: 32 } as const;

const questionsParam = {
  type: 'array',
  minItems: 2,
  maxItems: 32,
  description:
    'Survey projects only, and required for them: the full question flow, sequence 1..N with no gaps, ' +
    'sequence 1 the intro. intro opens the survey; multiple_choice takes 2-9 response_options (the digit ' +
    'a recipient texts, 1-9, and a label); open_ended takes none; outro closes and expects no reply. Only ' +
    'recipients who reply move on. next_sequence (per option) and no_match_sequence (a reply matching no ' +
    'option) branch to a LATER question; omit them to go to sequence + 1. question_text is at most 10 SMS ' +
    'parts (1,500 characters on mms) and takes merge tags; options are never appended to it, so write ' +
    'them into the text ("Reply 1 for Yes, 2 for No").',
  items: {
    type: 'object',
    properties: {
      sequence: sequenceNumber,
      question_type: { type: 'string', enum: ['intro', 'multiple_choice', 'open_ended', 'outro'] },
      question_text: { type: 'string', minLength: 1, maxLength: 1600 },
      message_type: { type: 'string', enum: ['sms', 'mms'], description: 'Defaults to sms; mms needs media_ids' },
      media_ids: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'mms questions only' },
      response_options: {
        type: 'array',
        minItems: 2,
        maxItems: 9,
        items: {
          type: 'object',
          properties: {
            value: { type: 'integer', minimum: 1, maximum: 9 },
            label: { type: 'string', minLength: 1, maxLength: 200 },
            next_sequence: sequenceNumber,
          },
          required: ['value', 'label'],
          additionalProperties: false,
        },
      },
      no_match_sequence: sequenceNumber,
      is_required: { type: 'boolean', description: 'Defaults to true' },
    },
    required: ['sequence', 'question_type', 'question_text'],
    additionalProperties: false,
  },
} as const;

const TAG_TRIGGER_WARNING =
  'Tagging a contact into a tag that has live triggers MESSAGES that contact: it enters every started ' +
  'triggered project or campaign listening for the tag (each person at most once). Call list_tags first ' +
  'and read the tag\'s live_triggers. When live_triggers is empty, fire_triggers changes nothing. When it ' +
  'is not, decide fire_triggers deliberately; before sending fire_triggers: true for a contact list or an ' +
  'import, tell the user which live triggers will message those contacts and get their explicit yes, and ' +
  'only then pass confirm: true.';

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

const TAG_CONSENT_RULE =
  'A tagged contact is only sent to through a list row the sender can use: a tagged phone must be on ' +
  'a live contact list this project can send to (unscoped, or scoped to its own brand, toll-free ' +
  'number, or short code), and a tagged email address must be subscribed on a list the sending domain ' +
  'can use. Tags never reach a contact who is on no such list. Opt-outs and unsubscribes always apply.';

const tagIdsParam = (description: string) =>
  ({ type: 'array', items: { type: 'string' }, maxItems: 50, description }) as const;

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
      'test-send activity tracked separately from the production metrics, and `cost_breakdown`: ' +
      'messages, segments, and cost per product (outbound and inbound SMS and MMS), summing to ' +
      'the project total.',
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
      'Get one contact list by ID, including its available merge tags, phone import progress (import), email side status and counts (email), and list analysis results when available. ' +
      'When import.status or email.status is failed, that side\'s error ({ code, message }, null otherwise) says why; the message is safe to show the user.',
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
      'protocol (sms or mms), sending phone number IDs, contact list IDs or tag IDs, and the message text. ' +
      'For a survey pass type "survey", campaign_id, and questions (an intro, then questions with ' +
      'numbered response options or open answers, then usually an outro) INSTEAD of protocol, ' +
      'message_text, and media_ids; a survey takes contact lists and tags like a broadcast, never ' +
      'follow_ups, brand_id, or opt_out_footer_enabled, and needs campaign_id on every channel. ' +
      'For a triggered project (no contact list; each phone number gets it at most once, when the trigger ' +
      'fires) pass type "triggered" and a trigger instead of contact_list_ids; start it with ' +
      'start_project after test_project. A tag trigger texts a tagged phone on a list the project can use ' +
      'with that row\'s merge fields, and one on no list with merge-field defaults; opt-outs always apply. ' +
      'follow_ups adds up to 9 texts after the first message: a person stops getting them on a reply ' +
      '(stop_on_reply), a tracked-link click (stop_on_click), or an opt-out, and each follow-up is charged ' +
      'when it sends, so tell the user the cost can be up to the first message times the number of steps. ' +
      'For channel=10dlc also pass brand_id and campaign_id; for channel=toll-free pass ' +
      'toll_free_verification_id. Recipients are the union of contact_list_ids and tag_ids (contacts ' +
      'carrying ANY of those tags); require_tag_ids then keeps only contacts carrying ALL of its tags, ' +
      'and suppression_tag_ids leaves out contacts carrying any of its tags. ' + TAG_CONSENT_RULE + ' ' +
      'A project with neither a list nor a tag_ids entry is created as a draft. ' +
      'Creating a project does not send messages by itself. A 409 ' +
      '`LIST_ANALYSIS_IN_PROGRESS` means a contact list is still being analyzed; wait until ' +
      '`get_contact_list` shows `analysis.status` `complete`, then retry. A 409 `LIST_ARCHIVED` ' +
      'names a list whose contacts were removed 12 months after upload; choose another list.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        organization_id: { type: 'string', description: 'Owning organization ID' },
        type: {
          type: 'string',
          enum: ['broadcast', 'survey', 'triggered'],
          description:
            'Project type. Defaults to broadcast. Triggered requires trigger and takes no list IDs. Survey ' +
            'requires questions and campaign_id and takes no protocol or message_text.',
        },
        trigger: triggerParam,
        questions: questionsParam,
        ai_survey_analysis_enabled: {
          type: 'boolean',
          description: 'Survey projects only: AI classifies replies no option matches, billed per analyzed reply. Default false.',
        },
        follow_ups: followUpsParam,
        scheduled_timezone: {
          ...scheduleTimezoneParam,
          description:
            'Project time zone. Required with a follow-up that waits days or a next_day trigger start; a ' +
            'broadcast takes it here only for day follow-ups.',
        },
        sequence_send_time: {
          type: 'string',
          description: 'Local time of day, HH:MM, that day follow-ups and a next_day trigger start send at.',
        },
        name: { type: 'string', description: 'Project name' },
        protocol: { type: 'string', enum: ['sms', 'mms'], description: 'Message protocol. Required unless type is survey.' },
        message_text: { type: 'string', description: 'The message body to send. Required unless type is survey.' },
        phone_number_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sending phone number IDs (1-49)',
        },
        contact_list_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Contact list IDs to send to. Send this, tag_ids, or both, unless type is triggered. Omit rather than send an empty array.',
        },
        tag_ids: tagIdsParam(
          'Tag IDs (from list_tags): also send to contacts carrying ANY of these tags. Each contact must still be on a ' +
            'live list this sender can use. Not for triggered projects.',
        ),
        require_tag_ids: tagIdsParam(
          'Tag IDs: keep only recipients carrying ALL of these tags (narrows the lists and tag_ids, never adds anyone).',
        ),
        suppression_tag_ids: tagIdsParam(
          'Tag IDs: leave out recipients carrying any of these tags for this send. Cannot repeat a tag_ids or require_tag_ids entry.',
        ),
        channel: {
          type: 'string',
          enum: ['10dlc', 'toll-free'],
          description: 'Messaging channel. Defaults to 10dlc.',
        },
        brand_id: { type: 'string', description: 'Required when channel=10dlc; never on a survey' },
        campaign_id: { type: 'string', description: 'Required when channel=10dlc, and always for a survey' },
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
      '`get_contact_list` shows `analysis.status` `complete`, then retry. A 409 `LIST_ARCHIVED` ' +
      'names a list whose contacts were removed 12 months after upload, and a 409 ' +
      '`NO_SENDABLE_CONTACTS` means the lists hold no contact that can receive a text; choose ' +
      'another list.',
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
        scheduled_timezone: { ...scheduleTimezoneParam, description: 'One of the six supported US IANA zones' },
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
      'is not triggered. Pause with pause_project. A tag trigger\'s first start needs audience; with ' +
      'current_and_new it also texts everyone carrying the tag now, so say how many (list_tags member_count) ' +
      'before confirming.',
    inputSchema: {
      type: 'object',
      properties: { confirm: confirmParam, id: idParam, audience: audienceParam },
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
      'a real text. Answers queued with send_at, or already_entered with a reason: duplicate (a repeated ' +
      'occurrence_id) or already_entered (each person gets it at most once). A paused project returns 409 CONFLICT; an opted-out number ' +
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
      'Schedule an email campaign, or omit scheduled_at to send now (or to start a triggered campaign). ' +
      'This commits a real send to every recipient on the campaign lists. If it is refused, read ' +
      '"blocked" on the campaign. A tag-triggered campaign\'s first start needs audience.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 date-time. Omit to send immediately. A past date is rejected.',
        },
        audience: audienceParam,
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
      'a reason: duplicate (a repeated occurrence_id) or already_entered (each address gets it at most once). A paused campaign returns 409 CONFLICT; a ' +
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
    name: 'list_tags',
    description:
      'List the contact tags of one organization, sorted by name. A tag labels a phone number or email ' +
      'address. kind manual: members are added with add_tag_contacts (member_count is capped at 10000, ' +
      'see member_count_capped). kind activity: applies by itself while true (activity_event donated, ' +
      'clicked, responded, or sent, within the last within_days days or ever) and has no member_count. ' +
      'Use the ids in create_project tag_ids, require_tag_ids, and suppression_tag_ids, or in a tag trigger. ' +
      'live_triggers lists the started triggered projects (channel text) and email campaigns (channel email) ' +
      'listening for the tag: tagging contacts into such a tag messages them, so read it before ' +
      'add_tag_contacts or an import that tags.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: { type: 'string', description: 'Organization. Defaults to the key owner.' } },
      additionalProperties: false,
    },
    annotations: { title: 'List Tags', readOnlyHint: true },
  },
  {
    name: 'create_tag',
    description:
      'Create a contact tag: a manual tag by name, or an activity tag by activity_event (donated, ' +
      'clicked, responded, sent) and optional within_days (1-365). Creating an activity tag that already ' +
      'exists returns it. A 409 TAG_NAME_TAKEN means the organization already has that name (ignoring case). ' +
      'Creating a tag tags nobody; it changes a send only once a project uses it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Manual tag name, 1-64 characters. Omit for an activity tag.' },
        activity_event: {
          type: 'string',
          enum: ['donated', 'clicked', 'responded', 'sent'],
          description: 'Activity tag event. Omit for a manual tag.',
        },
        within_days: { type: 'number', minimum: 1, maximum: 365, description: 'Activity tags only. Omit for ever.' },
        organization_id: { type: 'string', description: 'Organization. Defaults to the key owner.' },
      },
      additionalProperties: false,
    },
    annotations: {
      title: 'Create Tag',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'rename_tag',
    description:
      'Rename a manual tag. Activity tags are named by their rule (400 TAG_NOT_MANUAL). A 409 ' +
      'TAG_NAME_TAKEN means the organization already has that name.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam, name: { type: 'string', description: 'New name, 1-64 characters.' } },
      required: ['id', 'name'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Rename Tag',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'add_tag_contacts',
    description:
      'Put a manual tag on contacts. Name the tag by id or by name, exactly one of the two. A name is ' +
      'matched ignoring case, and when the organization has no tag with that name this call CREATES it: ' +
      'call list_tags first and pass a name exactly as listed, so a variant spelling does not create a ' +
      'near-duplicate tag. The result then carries the tag (use tag.id in create_project) and created: ' +
      'true means this call made a new tag; if you did not intend that, tell the user. Contacts are ' +
      'identifiers (up to 10000 US phone numbers in any common format or email addresses) or ' +
      'contact_list_id (every active phone and subscribed address on that list), exactly one of the two. ' +
      'identifiers return added and invalid counts. contact_list_id runs in the background: the result is ' +
      'queued: true and a job_id, with no counts (there is no job status tool). Tell the user the tagging is ' +
      'in progress, never that zero were added; the outcome shows as the tag\'s member_count in list_tags ' +
      'once the job finishes. This changes who a project using the tag reaches. ' +
      TAG_CONSENT_RULE + ' ' + TAG_TRIGGER_WARNING + ' fire_triggers defaults to true for identifiers and ' +
      'false for contact_list_id; with live triggers the result carries triggers.entered. A 409 TAG_BUSY ' +
      'means an import is writing the same contacts; retry in about a minute. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: { type: 'string', description: 'Tag ID (from list_tags). Omit when name is set.' },
        name: {
          type: 'string',
          description:
            'Tag name, 1-64 characters, instead of id. Creates the tag when none has this name (ignoring case).',
        },
        organization_id: {
          type: 'string',
          description: 'With name only: the organization whose tag to use. Defaults to the key owner.',
        },
        identifiers: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10000,
          description: 'Phone numbers or email addresses. Omit when contact_list_id is set.',
        },
        contact_list_id: { type: 'string', description: 'Tag everyone on this list. Omit when identifiers is set.' },
        fire_triggers: {
          type: 'boolean',
          description:
            'Whether newly tagged contacts enter the tag\'s live_triggers (which messages them). Default true ' +
            'for identifiers, false for contact_list_id. Ask the user before passing true with contact_list_id.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Add Tag Contacts',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'import_contact_list',
    description:
      'Import a CSV of contacts as a new list of phones, emails, or both. The server fetches ' +
      'source_url over https (50 MB cap), so this changes who a project or email campaign will ' +
      'reach. Name phone_column, email_column, or both; there is no automatic email column ' +
      'detection. consent_source is optional and allowed only for an audience list with an email column. With merge_tags, phones map only the named columns while emails also map every remaining column. purpose ' +
      'do_not_contact turns phones into an opt-out list and emails into unsubscribes, and ' +
      'returns no list_id. An audience import can tag every contact with tag_ids or tag_names, or per row ' +
      'with tags_column. ' + TAG_TRIGGER_WARNING + ' fire_triggers defaults to false here. ' +
      'Poll get_contact_list: import is the phone side and email.status is the email side. Requires confirm: true.',
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
        tag_ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'Audience imports only. Manual tag IDs put on every imported phone and email.',
        },
        tag_names: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'Audience imports only. Tag names put on every imported contact; missing tags are created.',
        },
        tags_column: {
          type: 'string',
          description:
            'Audience imports only. A CSV header whose cells hold tag names separated by commas, semicolons, or pipes. ' +
            'New tags are created; more than 100 new tags fails the import.',
        },
        fire_triggers: {
          type: 'boolean',
          description:
            'Default false. True enters the contacts this import newly tags into those tags\' live_triggers, ' +
            'which messages them. Ask the user before passing true.',
        },
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
  // Each writes contacts into a list or a tag, changing who a send reaches.
  'import_contact_list',
  'add_tag_contacts',
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

/** A survey's body and a message's are each strict in the API; naming the field here beats its 400. */
const MESSAGE_ONLY_ARGS = [
  'protocol', 'message_text', 'media_ids', 'opt_out_footer_enabled', 'follow_ups', 'trigger', 'brand_id',
  'toll_free_verification_id', 'scheduled_timezone', 'sequence_send_time',
];
const SURVEY_ONLY_ARGS = ['questions', 'ai_survey_analysis_enabled'];

function refuseArgs(args: Args, keys: string[], why: string): void {
  const sent = keys.filter((key) => args[key] !== undefined);
  if (sent.length > 0) throw new Error(`${why}: remove ${sent.join(', ')}.`);
}

function createSurveyRequest(args: Args): CreateSurveyProjectRequest {
  refuseArgs(args, MESSAGE_ONLY_ARGS, 'A survey sends questions, not a message');
  if (!Array.isArray(args.questions) || args.campaign_id === undefined) {
    throw new Error('A survey needs questions and campaign_id.');
  }
  return {
    type: 'survey',
    organization_id: s(args, 'organization_id'),
    campaign_id: s(args, 'campaign_id'),
    name: s(args, 'name'),
    channel: opt(args, 'channel') as '10dlc' | 'toll-free' | undefined,
    phone_number_ids: (args.phone_number_ids as string[]) ?? [],
    contact_list_ids: args.contact_list_ids as string[] | undefined,
    suppression_list_ids: args.suppression_list_ids as string[] | undefined,
    tag_ids: args.tag_ids as string[] | undefined,
    require_tag_ids: args.require_tag_ids as string[] | undefined,
    suppression_tag_ids: args.suppression_tag_ids as string[] | undefined,
    questions: args.questions as SurveyQuestionInput[],
    link_tracking_enabled: args.link_tracking_enabled as boolean | undefined,
    link_tracking_destination_url: opt(args, 'link_tracking_destination_url'),
    link_tracking_domain_id: opt(args, 'link_tracking_domain_id'),
    link_tracking_param_field: opt(args, 'link_tracking_param_field'),
    link_tracking_fallback_url: opt(args, 'link_tracking_fallback_url'),
    ai_survey_analysis_enabled: args.ai_survey_analysis_enabled as boolean | undefined,
  };
}

function createProjectRequest(args: Args): CreateProjectRequest {
  if (args.type === 'survey') return createSurveyRequest(args);
  refuseArgs(args, SURVEY_ONLY_ARGS, 'Only a survey takes questions; pass type "survey"');
  if (args.protocol === undefined || args.message_text === undefined) {
    throw new Error('A broadcast or triggered project needs protocol and message_text.');
  }
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
    follow_ups: args.follow_ups as ProjectFollowUps | undefined,
    scheduled_timezone: opt(args, 'scheduled_timezone') as ScheduleTimezone | undefined,
    sequence_send_time: opt(args, 'sequence_send_time'),
  };
  if (args.type === 'triggered') {
    return { ...base, type: 'triggered', trigger: args.trigger as Trigger };
  }
  // Omitted stays omitted: the API refuses an empty contact_list_ids, and a
  // project may name only tags.
  return {
    ...base,
    type: opt(args, 'type') as 'broadcast' | undefined,
    contact_list_ids: args.contact_list_ids as string[] | undefined,
    suppression_list_ids: args.suppression_list_ids as string[] | undefined,
    tag_ids: args.tag_ids as string[] | undefined,
    require_tag_ids: args.require_tag_ids as string[] | undefined,
    suppression_tag_ids: args.suppression_tag_ids as string[] | undefined,
  };
}

function createTagRequest(args: Args): CreateTagRequest {
  const organization_id = opt(args, 'organization_id');
  if (args.name !== undefined) return { name: s(args, 'name'), organization_id };
  return {
    activity_event: s(args, 'activity_event') as TagActivityEvent,
    within_days: optNum(args, 'within_days'),
    organization_id,
  };
}

function tagContactsRequest(args: Args): AddTagContactsRequest {
  const source: TagContactsRequest =
    args.contact_list_id === undefined
      ? { identifiers: (args.identifiers as string[]) ?? [] }
      : { contact_list_id: s(args, 'contact_list_id') };
  return args.fire_triggers === undefined ? source : { ...source, fire_triggers: args.fire_triggers === true };
}

/** A tag id addresses one tag; a name finds or creates one, so exactly one must be given. */
async function addTagContacts(client: PoliticalCommsClient, args: Args) {
  if ((args.id === undefined) === (args.name === undefined)) {
    throw new Error('add_tag_contacts takes exactly one of id or name.');
  }
  const source = tagContactsRequest(args);
  if (args.id !== undefined) return client.addTagContacts(s(args, 'id'), source);
  return client.tagContacts({ ...source, name: s(args, 'name'), organization_id: opt(args, 'organization_id') });
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
    case 'start_project': {
      const audience = opt(args, 'audience') as TriggerAudience | undefined;
      return textResult(await client.startProject(s(args, 'id'), audience ? { audience } : undefined));
    }
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
          ...(args.audience === undefined ? {} : { audience: s(args, 'audience') as TriggerAudience }),
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
    case 'list_tags':
      return textResult(await client.listTags({ organization_id: opt(args, 'organization_id') }));
    case 'create_tag':
      return textResult(await client.createTag(createTagRequest(args)));
    case 'rename_tag':
      return textResult(await client.renameTag(s(args, 'id'), { name: s(args, 'name') }));
    case 'add_tag_contacts':
      return textResult(await addTagContacts(client, args));

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
          tag_ids: args.tag_ids as string[] | undefined,
          tag_names: args.tag_names as string[] | undefined,
          tags_column: opt(args, 'tags_column'),
          ...(args.fire_triggers === undefined ? {} : { fire_triggers: args.fire_triggers === true }),
        }),
      );

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function start(): Promise<void> {
  const server = new Server(
    { name: 'political-comms', version: '0.23.0' },
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
      client ??= new PoliticalCommsClient({ baseUrl: process.env.POLITICAL_COMMS_BASE_URL });
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
