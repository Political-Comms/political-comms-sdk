import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { PoliticalCommsClient, PoliticalCommsError, type ScheduleTimezone } from '@political-comms/sdk';

const SERVER_INSTRUCTIONS =
  'Political Comms is a direct-to-carrier political texting platform for US campaigns, PACs, ' +
  'advocacy organizations, fundraisers, and elected officials. Use these tools to inspect ' +
  'organizations, projects, contact lists, analytics, and billing, and to create, test, and ' +
  'schedule compliant political SMS and MMS sends. An API key is required via the ' +
  'POLITICAL_COMMS_API_KEY environment variable (created in the dashboard under Admin > API Keys). ' +
  'The write tools create_project, test_project, and schedule_project send or stage real messages ' +
  'and require confirm: true. Rate limits per key (60-second sliding window): 100 requests/minute ' +
  'for reads, 60/minute for writes.';

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
            'the parameter is appended as its own query pair',
        },
        link_tracking_domain_id: { type: 'string', description: 'Tracking domain ID' },
        link_tracking_param_field: {
          type: 'string',
          description: 'Contact field carried on tracking-link redirects (phone or a custom-field name)',
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
  {
    name: 'archive_project',
    description:
      'Archive a completed project so it no longer appears in default project listings. Only ' +
      'projects in completed status can be archived; other statuses are rejected with ' +
      'INVALID_STATE_TRANSITION.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'ID of the project to archive' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Archive Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];

const CONFIRM_REQUIRED = new Set(['create_project', 'test_project', 'schedule_project']);

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
      'dashboard (Admin > API Keys) and set it as the POLITICAL_COMMS_API_KEY environment variable ' +
      'for this MCP server.'
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
        }),
      );
    case 'unschedule_project':
      return textResult(await client.unscheduleProject(s(args, 'id')));
    case 'copy_project':
      return textResult(await client.copyProject(s(args, 'project_id')));
    case 'archive_project':
      return textResult(await client.archiveProject(s(args, 'project_id')));
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function start(): Promise<void> {
  const server = new Server(
    { name: 'political-comms', version: '0.3.1' },
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
          ' A human must create a key in the Political Comms dashboard (Admin > API Keys) and set ' +
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
