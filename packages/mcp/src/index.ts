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
  type EmailListImportConsentSource,
  type ScheduleTimezone,
} from '@political-comms/sdk';

const SERVER_INSTRUCTIONS =
  'Political Comms is a direct-to-carrier political texting platform for US campaigns, PACs, ' +
  'advocacy organizations, fundraisers, and elected officials. Use these tools to inspect ' +
  'organizations, projects, contact lists, analytics, and billing, and to create, test, and ' +
  'schedule compliant political SMS and MMS sends. An API key is required via the ' +
  'POLITICAL_COMMS_API_KEY environment variable (created in the dashboard under Admin > API). ' +
  'The write tools create_project, test_project, schedule_project, reply_to_conversation, ' +
  'schedule_email_campaign, resume_email_campaign, create_email_template_draft, and ' +
  'start_email_list_import send real messages, spend money, or write contacts, and require ' +
  'confirm: true. Rate limits per key (60-second sliding window): 100 requests/minute for reads, ' +
  '60/minute for writes. ' +
  'The email tools (list_email_*, get_email_*, and the email campaign lifecycle) are EARLY ACCESS: ' +
  'every one returns 403 EMAIL_EARLY_ACCESS until the email product reaches general availability. ' +
  'There is no inbound email or inbox surface.';

// JSON Schema fragments reused across tools.
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
    name: 'list_contact_lists',
    description:
      'List contact lists with their contact counts and import status. Optionally filter by ' +
      'organization or brand.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: orgFilter, brand_id: brandFilter },
      additionalProperties: false,
    },
    annotations: { title: 'List Contact Lists', readOnlyHint: true },
  },
  {
    name: 'get_contact_list',
    description:
      'Get one contact list by ID, including import progress and list analysis results when available.',
    inputSchema: {
      type: 'object',
      properties: { id: idParam },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Contact List', readOnlyHint: true },
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
      'For channel=10dlc also pass brand_id and campaign_id; for channel=toll-free pass ' +
      'toll_free_verification_id. Creating a project does not send messages by itself.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        organization_id: { type: 'string', description: 'Owning organization ID' },
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
          description: 'Contact list IDs to send to',
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
        'contact_list_ids',
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
      'actual SMS or MMS to those recipients and incurs cost.',
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
      'commits a real bulk send to every contact on the lists once the scheduled time arrives.',
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
            'Optional. Run the whole project past the brand daily carrier limit instead of ' +
            'pausing at it. Only applies to brands T-Mobile meters (Aegis-vetted, non-political), ' +
            'which otherwise pause each Pacific day at their T-Mobile cap and must be started ' +
            'again to continue. Setting this accepts that messages to T-Mobile recipients over ' +
            'the limit may fail and are still billed. Defaults to false.',
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
      'Send a real SMS reply inside an existing conversation, from the same sending number, on the ' +
      'same project. This delivers an actual text message to the contact and incurs cost. Text is ' +
      '1-1600 characters, SMS only (no media). Final delivery state arrives on the existing ' +
      'message.sent / message.delivered / message.failed webhooks.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        id: idParam,
        text: { type: 'string', minLength: 1, maxLength: 1600, description: 'The reply text to send' },
      },
      required: ['confirm', 'id', 'text'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Reply To Conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  // -------------------------------------------------------------------------
  // Email (early access). Every tool below returns 403 EMAIL_EARLY_ACCESS
  // until the email product reaches general availability.
  // -------------------------------------------------------------------------
  {
    name: 'list_email_domains',
    description:
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
      'List email sender identities (From addresses). An identity missing a required physical ' +
      'address or disclaimer is paused rather than allowed to send.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List Email Senders', readOnlyHint: true },
  },
  {
    name: 'list_email_lists',
    description:
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
      'List email lists with their contact counts and status.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: emailLimit,
        cursor: emailCursor,
        search: emailSearch,
        source_type: {
          type: 'string',
          description: 'Filter by where the list came from',
          enum: ['uploaded', 'segmented', 'winred', 'anedot'],
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List Email Lists', readOnlyHint: true },
  },
  {
    name: 'list_email_suppressions',
    description:
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
    name: 'list_email_templates',
    description:
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
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
    name: 'start_email_list_import',
    description:
      'EARLY ACCESS (returns 403 EMAIL_EARLY_ACCESS until general availability). ' +
      'Import a CSV of contacts into an email list. The server fetches source_url over https ' +
      '(50 MB cap) and writes the contacts in one call, so this changes who a campaign will ' +
      'reach. Omit mapping to let the server recognize a common ESP export; if no email column ' +
      'is found the call returns 400 with the headers it read, so retry with a mapping. ' +
      'The consent source records how these people agreed to hear from you and is required. ' +
      'Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: confirmParam,
        source_url: { type: 'string', description: 'https URL of the CSV file.' },
        name: {
          type: 'string',
          description:
            'Name for the list this file becomes. Defaults to the file name. The file IS the list: an import creates one rather than adding to an existing list.',
        },
        email_domain_id: {
          type: 'string',
          description:
            'Scope the new list to one sending domain. Omit for an organization-wide list any campaign can use.',
        },
        consent_source: {
          type: 'string',
          description: 'How the people in this file consented to hear from you.',
          enum: [
            'donation_form',
            'petition',
            'signup_form',
            'event',
            'purchased',
            'rented',
            'other',
          ],
        },
        consent_note: { type: 'string', description: 'Optional detail about the consent, up to 1000 characters.' },
        mapping: {
          type: 'object',
          description: 'CSV header to contact field. Omit to use the server recognizer.',
          additionalProperties: { type: 'string' },
        },
        allow_role: {
          type: 'boolean',
          description: 'Accept role addresses (info@, sales@) instead of rejecting them.',
        },
      },
      required: ['confirm', 'source_url', 'consent_source'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Start Email List Import',
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
  'resume_email_campaign',
  // Spends $3.00 per finished draft.
  'create_email_template_draft',
  // Writes contacts into a list, changing who a campaign reaches.
  'start_email_list_import',
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
      'The API allows, per key over a 60-second sliding window, 100 requests/minute for reads and ' +
      '60/minute for writes. Wait until the time in the X-RateLimit-Reset ' +
      'header (Unix seconds) before retrying; the SDK already waited through its retry budget.'
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
    case 'get_project_stats':
      return textResult(await client.getProjectStats(s(args, 'id')));
    case 'list_contact_lists':
      return textResult(
        await client.listContactLists({
          organization_id: opt(args, 'organization_id'),
          brand_id: opt(args, 'brand_id'),
        }),
      );
    case 'get_contact_list':
      return textResult(await client.getContactList(s(args, 'id')));
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
      return textResult(
        await client.createProject({
          organization_id: s(args, 'organization_id'),
          channel: opt(args, 'channel') as '10dlc' | 'toll-free' | undefined,
          brand_id: opt(args, 'brand_id'),
          campaign_id: opt(args, 'campaign_id'),
          toll_free_verification_id: opt(args, 'toll_free_verification_id'),
          phone_number_ids: (args.phone_number_ids as string[]) ?? [],
          name: s(args, 'name'),
          protocol: s(args, 'protocol') as 'sms' | 'mms',
          contact_list_ids: (args.contact_list_ids as string[]) ?? [],
          suppression_list_ids: args.suppression_list_ids as string[] | undefined,
          media_ids: args.media_ids as string[] | undefined,
          message_text: s(args, 'message_text'),
          link_tracking_enabled: args.link_tracking_enabled as boolean | undefined,
          link_tracking_destination_url: opt(args, 'link_tracking_destination_url'),
          link_tracking_domain_id: opt(args, 'link_tracking_domain_id'),
          link_tracking_param_field: opt(args, 'link_tracking_param_field'),
          link_tracking_fallback_url: opt(args, 'link_tracking_fallback_url'),
          opt_out_footer_enabled: args.opt_out_footer_enabled as boolean | undefined,
        }),
      );
    case 'test_project': {
      const phones = (args.phones as string[]) ?? [];
      return textResult(
        await client.testProject(s(args, 'id'), {
          test_contacts: phones.map((phone) => ({ phone })),
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
      return textResult(await client.replyToConversation(s(args, 'id'), { text: s(args, 'text') }));

    // Email (early access): all of these return 403 EMAIL_EARLY_ACCESS until GA.
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
    case 'list_email_lists':
      return textResult(
        await client.listEmailLists({
          limit: optNum(args, 'limit'),
          cursor: opt(args, 'cursor'),
          search: opt(args, 'search'),
          source_type: opt(args, 'source_type') as never,
        }),
      );
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
    case 'start_email_list_import':
      return textResult(
        await client.startEmailListImport({
          source_url: s(args, 'source_url'),
          ...(args.name === undefined ? {} : { name: s(args, 'name') }),
          ...(args.email_domain_id === undefined
            ? {}
            : { email_domain_id: s(args, 'email_domain_id') }),
          consent: {
            source: s(args, 'consent_source') as EmailListImportConsentSource,
            ...(args.consent_note === undefined ? {} : { note: s(args, 'consent_note') }),
          },
          mapping: args.mapping as Record<string, string> | undefined,
          ...(args.allow_role === undefined
            ? {}
            : { options: { allow_role: args.allow_role as boolean } }),
        }),
      );

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function start(): Promise<void> {
  const server = new Server(
    { name: 'political-comms', version: '0.10.0' },
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
        `Refusing to run ${name}: it stages or sends real political text messages and incurs cost. ` +
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
