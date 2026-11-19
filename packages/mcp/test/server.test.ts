import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DIST_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'list_organizations',
  'get_hierarchy',
  'list_projects',
  'get_project',
  'get_project_stats',
  'get_project_survey_results',
  'get_project_throughput',
  'get_campaign_throughput',
  'list_contact_lists',
  'get_contact_list',
  'download_contact_list',
  'import_contact_list',
  'get_message_stats',
  'get_ledger_usage',
  'list_tags',
  'create_tag',
  'rename_tag',
  'add_tag_contacts',
  'create_project',
  'test_project',
  'schedule_project',
  'unschedule_project',
  'pause_project',
  'start_project',
  'end_project',
  'add_project_recipient',
  'create_project_hook',
  'copy_project',
  'list_conversations',
  'get_conversation',
  'list_conversation_messages',
  'reply_to_conversation',
  'list_webhook_endpoints',
  'get_webhook_endpoint',
  // Email. Reads and the campaign lifecycle; no delete_* tools, so the
  // surface stays non-destructive.
  'list_email_domains',
  'get_email_domain',
  'list_email_senders',
  'list_email_suppressions',
  'list_email_campaigns',
  'get_email_campaign',
  'get_email_campaign_stats',
  'schedule_email_campaign',
  'unschedule_email_campaign',
  'pause_email_campaign',
  'resume_email_campaign',
  'end_email_campaign',
  'add_email_campaign_recipient',
  'create_email_campaign_hook',
  'list_email_templates',
  'get_email_template',
];

describe('political-comms MCP server (stdio)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_ENTRY],
      env: { ...process.env, POLITICAL_COMMS_API_KEY: 'pc_live_test' } as Record<string, string>,
    });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client.close();
  });

  it('lists all expected tools with descriptions and annotations', async () => {
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());

    // The MCP surface deliberately exposes no destructive delete operations.
    expect(names.filter((name) => name.startsWith('delete_'))).toEqual([]);

    for (const tool of result.tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThanOrEqual(30);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.annotations, `${tool.name} annotations`).toBeTruthy();
    }

    const readOnly = result.tools.filter((tool) => tool.annotations?.readOnlyHint === true);
    expect(readOnly.map((tool) => tool.name).sort()).toEqual(
      [
        'list_organizations',
        'get_hierarchy',
        'list_projects',
        'get_project',
        'get_project_stats',
        'get_project_survey_results',
        'get_project_throughput',
        'get_campaign_throughput',
        'list_contact_lists',
        'get_contact_list',
        'download_contact_list',
        'get_message_stats',
        'get_ledger_usage',
        'list_tags',
        'list_conversations',
        'get_conversation',
        'list_conversation_messages',
        'list_webhook_endpoints',
        'get_webhook_endpoint',
        // Email reads.
        'list_email_domains',
        'get_email_domain',
        'list_email_senders',
                    'list_email_suppressions',
        'list_email_campaigns',
        'get_email_campaign',
        'get_email_campaign_stats',
        'list_email_templates',
        'get_email_template',
                  ].sort(),
    );
  });

  it('advertises merge_values as an optional string map on test_project, not required', async () => {
    const result = await client.listTools();
    const testProject = result.tools.find((tool) => tool.name === 'test_project');
    expect(testProject).toBeTruthy();
    const schema = testProject!.inputSchema as {
      properties: Record<string, { type?: string; additionalProperties?: unknown }>;
      required: string[];
    };
    expect(schema.properties.merge_values).toEqual(
      expect.objectContaining({ type: 'object', additionalProperties: { type: 'string' } }),
    );
    expect(schema.required).not.toContain('merge_values');
  });

  it('requires confirm on import_contact_list and offers the channel filter on list_contact_lists', async () => {
    const result = await client.listTools();
    const importTool = result.tools.find((tool) => tool.name === 'import_contact_list');
    expect((importTool!.inputSchema as { required: string[] }).required).toEqual(
      expect.arrayContaining(['confirm', 'source_url', 'list_name']),
    );
    const listTool = result.tools.find((tool) => tool.name === 'list_contact_lists');
    const props = (listTool!.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.channel?.enum).toEqual(['text', 'email', 'all']);

    const refused = await client.callTool({
      name: 'import_contact_list',
      arguments: { source_url: 'https://example.com/a.csv', list_name: 'A', email_column: 'Email' },
    });
    expect(refused.isError).toBe(true);
  });

  it('refuses write tools without confirm: true', async () => {
    const result = await client.callTool({
      name: 'schedule_project',
      arguments: {
        confirm: false,
        id: 'proj_1',
        scheduled_at: '2026-11-03T09:00:00',
        scheduled_timezone: 'America/New_York',
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('confirm: true');
  });

  it('refuses the triggered write tools that send without confirm: true', async () => {
    for (const [name, args] of [
      ['start_project', { confirm: false, id: 'proj_1' }],
      ['add_project_recipient', { confirm: false, id: 'proj_1', phone_number: '+12025550141' }],
      ['add_email_campaign_recipient', { confirm: false, id: 'camp_1', email: 'ada@example.org' }],
      ['resume_email_campaign', { confirm: false, id: 'camp_1' }],
      ['add_tag_contacts', { confirm: false, id: 'tag_1', identifiers: ['+12025550141'] }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text, name).toContain('confirm: true');
    }
  });

  it('requires confirm on resume_email_campaign but not pause_email_campaign', async () => {
    const result = await client.listTools();
    const required = (name: string) =>
      (result.tools.find((t) => t.name === name)!.inputSchema as { required: string[] }).required;
    expect(required('resume_email_campaign')).toEqual(expect.arrayContaining(['confirm', 'id']));
    expect(required('pause_email_campaign')).toEqual(['id']);
  });

  it('offers type and trigger on create_project and no longer requires contact_list_ids', async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'create_project');
    const schema = tool!.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.properties.type?.enum).toEqual(['broadcast', 'survey', 'triggered']);
    expect(schema.properties.trigger).toBeTruthy();
    expect(schema.required).not.toContain('contact_list_ids');
  });

  it('offers survey questions on create_project with the API limits, still behind confirm', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'create_project')!;
    const schema = tool.inputSchema as unknown as {
      properties: Record<string, { minItems?: number; maxItems?: number; items?: { required: string[]; properties: Record<string, { enum?: string[]; maxItems?: number }> } }>;
      required: string[];
    };
    const questions = schema.properties.questions!;
    expect([questions.minItems, questions.maxItems]).toEqual([2, 32]);
    expect(questions.items!.required).toEqual(['sequence', 'question_type', 'question_text']);
    expect(questions.items!.properties.question_type!.enum).toEqual(['intro', 'multiple_choice', 'open_ended', 'outro']);
    expect(questions.items!.properties.response_options!.maxItems).toBe(9);
    expect(schema.required).toContain('confirm');
    expect(schema.required).not.toContain('message_text');
    expect(schema.required).not.toContain('protocol');
    expect(tool.description).toContain('type "survey"');
    expect(tool.description).toContain('never follow_ups');
  });

  it('offers tag triggers and start times, and no reentry, on the trigger', async () => {
    const result = await client.listTools();
    const trigger = (result.tools.find((t) => t.name === 'create_project')!.inputSchema.properties as unknown as {
      trigger: { properties: Record<string, { enum?: string[] }>; description: string };
    }).trigger;
    expect(trigger.properties.source?.enum).toEqual(['api', 'donation', 'event', 'tag']);
    expect(trigger.properties.start?.enum).toEqual(['immediate', 'next_day']);
    expect(trigger.properties.tag).toBeTruthy();
    expect(trigger.properties).not.toHaveProperty('reentry');
    expect(trigger.description).toContain('at most once');
  });

  it('describes follow-ups on create_project: the stop rules, once per person, and per-send charges', async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'create_project')!;
    const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.follow_ups).toBeTruthy();
    expect(props.scheduled_timezone).toBeTruthy();
    expect(props.sequence_send_time).toBeTruthy();
    expect(props.follow_ups!.description).toContain('stop_on_reply');
    expect(props.follow_ups!.description).toContain('stop_on_click');
    expect(tool.description).toContain('at most once');
    expect(tool.description).toContain('charged when it sends');
  });

  it('warns that tagging into a live trigger messages people on add_tag_contacts and import_contact_list', async () => {
    const result = await client.listTools();
    for (const name of ['add_tag_contacts', 'import_contact_list']) {
      const tool = result.tools.find((t) => t.name === name)!;
      expect(tool.description, name).toContain('MESSAGES');
      expect(tool.description, name).toContain('live_triggers');
      expect(tool.description, name).toContain('get their explicit yes');
      expect((tool.inputSchema as { properties: Record<string, unknown> }).properties, name).toHaveProperty('fire_triggers');
      expect((tool.inputSchema as { required: string[] }).required, name).toContain('confirm');
    }
    expect(result.tools.find((t) => t.name === 'list_tags')!.description).toContain('live_triggers');
  });

  it('offers audience on start_project and schedule_email_campaign, and no too_soon anywhere', async () => {
    const result = await client.listTools();
    for (const name of ['start_project', 'schedule_email_campaign']) {
      const props = (result.tools.find((t) => t.name === name)!.inputSchema as {
        properties: Record<string, { enum?: string[] }>;
      }).properties;
      expect(props.audience?.enum, name).toEqual(['current_and_new', 'new_only']);
    }
    expect(JSON.stringify(result.tools)).not.toContain('too_soon');
    expect(JSON.stringify(result.tools)).not.toContain('reentry');
  });
});

type Recorded = { method: string; path: string; body: unknown };

/** Runs the built server against a local API stub, so a tool call's HTTP request can be asserted. */
describe('political-comms MCP server tag requests', () => {
  let client: Client;
  let api: Server;
  const requests: Recorded[] = [];
  const reply: { data: unknown; status?: number } = { data: {} };

  async function readBody(req: IncomingMessage): Promise<unknown> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : undefined;
  }

  async function call(name: string, args: Record<string, unknown>): Promise<{ request: Recorded; text: string }> {
    requests.length = 0;
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(result.isError, text).toBeFalsy();
    expect(requests).toHaveLength(1);
    return { request: requests[0]!, text };
  }

  beforeAll(async () => {
    api = createServer(async (req, res) => {
      requests.push({ method: req.method!, path: req.url!, body: await readBody(req) });
      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: reply.data }));
      reply.status = undefined;
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const { port } = api.address() as AddressInfo;

    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [DIST_ENTRY],
        env: {
          ...process.env,
          POLITICAL_COMMS_API_KEY: 'pc_live_test',
          POLITICAL_COMMS_BASE_URL: `http://127.0.0.1:${port}/v1`,
        } as Record<string, string>,
      }),
    );
  }, 20_000);

  afterAll(async () => {
    await client.close();
    await new Promise((resolve) => api.close(resolve));
  });

  it('list_tags GETs /tags with the organization and returns the tags', async () => {
    reply.data = [{ id: 'tag_1', name: 'Volunteers', kind: 'manual', member_count: 3 }];
    const { request, text } = await call('list_tags', { organization_id: 'org_2' });
    expect(request).toEqual({ method: 'GET', path: '/v1/tags?organization_id=org_2', body: undefined });
    expect(JSON.parse(text).data[0].name).toBe('Volunteers');
  });

  it('create_tag POSTs a manual tag by name', async () => {
    reply.data = { id: 'tag_1', name: 'Volunteers', kind: 'manual' };
    const { request } = await call('create_tag', { name: 'Volunteers' });
    expect(request).toEqual({ method: 'POST', path: '/v1/tags', body: { name: 'Volunteers' } });
  });

  it('create_tag POSTs an activity tag with its window', async () => {
    reply.data = { id: 'tag_2', kind: 'activity' };
    const { request } = await call('create_tag', { activity_event: 'clicked', within_days: 30, organization_id: 'org_2' });
    expect(request.body).toEqual({ activity_event: 'clicked', within_days: 30, organization_id: 'org_2' });
  });

  it('rename_tag PATCHes the tag', async () => {
    reply.data = { id: 'tag_1', name: 'Core' };
    const { request } = await call('rename_tag', { id: 'tag_1', name: 'Core' });
    expect(request).toEqual({ method: 'PATCH', path: '/v1/tags/tag_1', body: { name: 'Core' } });
  });

  it('add_tag_contacts POSTs identifiers or a contact list and returns the counts', async () => {
    reply.data = { added: 1, invalid: 1 };
    const byIdentifiers = await call('add_tag_contacts', { confirm: true, id: 'tag_1', identifiers: ['+12025550141', 'x'] });
    expect(byIdentifiers.request).toEqual({
      method: 'POST',
      path: '/v1/tags/tag_1/contacts',
      body: { identifiers: ['+12025550141', 'x'] },
    });
    expect(JSON.parse(byIdentifiers.text).data).toEqual({ added: 1, invalid: 1 });

  });

  it('add_tag_contacts with a contact list returns the 202 queued result as given', async () => {
    reply.data = { queued: true, job_id: 'job_1' };
    reply.status = 202;
    const byList = await call('add_tag_contacts', { confirm: true, id: 'tag_1', contact_list_id: 'cl_1' });
    expect(byList.request.body).toEqual({ contact_list_id: 'cl_1' });
    expect(JSON.parse(byList.text).data).toEqual({ queued: true, job_id: 'job_1' });
  });

  it('add_tag_contacts by name with a contact list returns the tag, created, and the job', async () => {
    reply.data = { tag: { id: 'tag_9', name: 'Donor' }, created: false, queued: true, job_id: 'job_2' };
    reply.status = 202;
    const { text } = await call('add_tag_contacts', { confirm: true, name: 'Donor', contact_list_id: 'cl_1' });
    expect(JSON.parse(text).data).toEqual({ tag: { id: 'tag_9', name: 'Donor' }, created: false, queued: true, job_id: 'job_2' });
  });

  it('tells the agent a list tagging runs in the background and where its outcome shows', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'add_tag_contacts')!;
    expect(tool.description).toContain('runs in the background');
    expect(tool.description).toContain('member_count in list_tags');
  });

  it('get_contact_list passes a failed import reason through', async () => {
    const error = { code: 'TAG_COLUMN_TOO_MANY_TAGS', message: 'That column would create more than 100 tags.' };
    reply.data = { list_id: 'cl_1', import: { status: 'failed', error }, email: null };
    const { request, text } = await call('get_contact_list', { id: 'cl_1' });
    expect(request).toEqual({ method: 'GET', path: '/v1/contact-lists/cl_1', body: undefined });
    expect(JSON.parse(text).data.import.error).toEqual(error);
  });

  it('add_tag_contacts with a name POSTs /tags/contacts and returns tag and created', async () => {
    reply.data = { tag: { id: 'tag_9', name: 'Donor' }, created: true, added: 1, invalid: 0 };
    const { request, text } = await call('add_tag_contacts', {
      confirm: true,
      name: 'Donor',
      organization_id: 'org_2',
      identifiers: ['ada@example.org'],
    });
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/tags/contacts',
      body: { identifiers: ['ada@example.org'], name: 'Donor', organization_id: 'org_2' },
    });
    expect(JSON.parse(text).data.created).toBe(true);
  });

  it('add_tag_contacts refuses both or neither of id and name without calling the API', async () => {
    for (const args of [
      { confirm: true, id: 'tag_1', name: 'Donor', identifiers: ['ada@example.org'] },
      { confirm: true, identifiers: ['ada@example.org'] },
    ]) {
      requests.length = 0;
      const result = await client.callTool({ name: 'add_tag_contacts', arguments: args });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('exactly one of id or name');
      expect(requests).toHaveLength(0);
    }
  });

  it('add_tag_contacts by name still requires confirm: true', async () => {
    requests.length = 0;
    const result = await client.callTool({
      name: 'add_tag_contacts',
      arguments: { name: 'Donor', identifiers: ['ada@example.org'] },
    });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('create_project sends the tag fields and leaves out an omitted contact_list_ids', async () => {
    reply.data = { project_id: 'proj_1', status: 'draft' };
    const { request } = await call('create_project', {
      confirm: true,
      organization_id: 'org_1',
      name: 'Tagged',
      protocol: 'sms',
      message_text: 'Hi',
      phone_number_ids: ['pn_1'],
      tag_ids: ['t1'],
      require_tag_ids: ['t2'],
      suppression_tag_ids: ['t3'],
    });
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/projects');
    expect(request.body).toMatchObject({ tag_ids: ['t1'], require_tag_ids: ['t2'], suppression_tag_ids: ['t3'] });
    expect(request.body).not.toHaveProperty('contact_list_ids');
  });

  it('create_project passes link_tracking_links through and offers it in the schema', async () => {
    reply.data = { project_id: 'proj_1', status: 'draft' };
    const links = [
      { destination_url: 'https://example.org/vote', param_fields: ['phone'] },
      { destination_url: 'https://example.org/volunteer' },
    ];
    const { request } = await call('create_project', {
      confirm: true,
      organization_id: 'org_1',
      name: 'Two links',
      protocol: 'sms',
      message_text: 'Vote {tracking_url} or volunteer {tracking_url_2}',
      phone_number_ids: ['pn_1'],
      link_tracking_enabled: true,
      link_tracking_domain_id: 'td_1',
      link_tracking_links: links,
    });
    expect(request.body).toMatchObject({ link_tracking_links: links });
    expect(request.body).not.toHaveProperty('link_tracking_destination_url');
    const tool = (await client.listTools()).tools.find((t) => t.name === 'create_project')!;
    expect(Object.keys(tool.inputSchema.properties as object)).toContain('link_tracking_links');
  });

  it('add_tag_contacts passes fire_triggers and returns triggers.entered', async () => {
    reply.data = { added: 1, invalid: 0, triggers: { entered: 1 } };
    const { request, text } = await call('add_tag_contacts', {
      confirm: true,
      id: 'tag_1',
      identifiers: ['+12025550141'],
      fire_triggers: false,
    });
    expect(request.body).toEqual({ identifiers: ['+12025550141'], fire_triggers: false });
    expect(JSON.parse(text).data.triggers).toEqual({ entered: 1 });
  });

  it('add_tag_contacts by name with a list sends fire_triggers: true', async () => {
    reply.data = { tag: { id: 'tag_1' }, created: false, queued: true, job_id: 'job_1', fire_triggers: true };
    const { request } = await call('add_tag_contacts', { confirm: true, name: 'Volunteers', contact_list_id: 'cl_1', fire_triggers: true });
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/tags/contacts',
      body: { contact_list_id: 'cl_1', fire_triggers: true, name: 'Volunteers' },
    });
  });

  it('start_project sends the audience; without one it sends no body', async () => {
    reply.data = { project_id: 'proj_1', status: 'active', type: 'triggered' };
    const withAudience = await call('start_project', { confirm: true, id: 'proj_1', audience: 'current_and_new' });
    expect(withAudience.request).toEqual({ method: 'POST', path: '/v1/projects/proj_1/start', body: { audience: 'current_and_new' } });
    const bare = await call('start_project', { confirm: true, id: 'proj_1' });
    expect(bare.request.body).toBeUndefined();
  });

  it('schedule_email_campaign sends the audience', async () => {
    reply.data = { id: 'camp_1', status: 'sending' };
    const { request } = await call('schedule_email_campaign', { confirm: true, id: 'camp_1', audience: 'new_only' });
    expect(request).toEqual({ method: 'POST', path: '/v1/email/campaigns/camp_1/schedule', body: { audience: 'new_only' } });
  });

  it('create_project sends a tag trigger with follow-ups and the send time', async () => {
    reply.data = { project_id: 'proj_2' };
    const followUps = {
      steps: [{ message_text: 'Still in?', wait: { unit: 'days', amount: 2 } }],
      stop_on_reply: true,
      stop_on_click: false,
    };
    const { request } = await call('create_project', {
      confirm: true,
      type: 'triggered',
      organization_id: 'org_1',
      name: 'Welcome',
      protocol: 'sms',
      message_text: 'Welcome!',
      phone_number_ids: ['pn_1'],
      trigger: { source: 'tag', tag: { tag_ids: ['tag_1'] }, start: 'next_day' },
      follow_ups: followUps,
      scheduled_timezone: 'America/Chicago',
      sequence_send_time: '09:00',
    });
    expect(request.body).toMatchObject({
      type: 'triggered',
      trigger: { source: 'tag', tag: { tag_ids: ['tag_1'] }, start: 'next_day' },
      follow_ups: followUps,
      scheduled_timezone: 'America/Chicago',
      sequence_send_time: '09:00',
    });
  });

  const surveyQuestions = [
    { sequence: 1, question_type: 'intro', question_text: 'Hi, 1 quick question?' },
    {
      sequence: 2,
      question_type: 'multiple_choice',
      question_text: 'Will you vote? Reply 1 Yes, 2 No.',
      response_options: [
        { value: 1, label: 'Yes' },
        { value: 2, label: 'No' },
      ],
    },
  ];

  it('create_project sends a survey with questions and no message fields', async () => {
    reply.data = { project_id: 'proj_3', type: 'survey', question_count: 2 };
    const { request } = await call('create_project', {
      confirm: true,
      type: 'survey',
      organization_id: 'org_1',
      campaign_id: 'camp_1',
      name: 'Intent',
      phone_number_ids: ['pn_1'],
      contact_list_ids: ['cl_1'],
      tag_ids: ['tag_1'],
      questions: surveyQuestions,
      ai_survey_analysis_enabled: true,
    });
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/projects',
      body: {
        type: 'survey',
        organization_id: 'org_1',
        campaign_id: 'camp_1',
        name: 'Intent',
        phone_number_ids: ['pn_1'],
        contact_list_ids: ['cl_1'],
        tag_ids: ['tag_1'],
        questions: surveyQuestions,
        ai_survey_analysis_enabled: true,
      },
    });
  });

  it('create_project refuses a mixed survey or message body without calling the API', async () => {
    const survey = { confirm: true, type: 'survey', organization_id: 'org_1', campaign_id: 'camp_1', name: 'S', phone_number_ids: ['pn_1'] };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...survey, questions: surveyQuestions, message_text: 'Hi', protocol: 'sms' }, 'remove protocol, message_text'],
      [survey, 'needs questions and campaign_id'],
      [{ confirm: true, organization_id: 'org_1', name: 'B', phone_number_ids: ['pn_1'], protocol: 'sms', message_text: 'Hi', questions: surveyQuestions }, 'Only a survey takes questions'],
      [{ confirm: true, organization_id: 'org_1', name: 'B', phone_number_ids: ['pn_1'] }, 'needs protocol and message_text'],
    ];
    for (const [args, message] of cases) {
      requests.length = 0;
      const result = await client.callTool({ name: 'create_project', arguments: args });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(message);
      expect(requests).toHaveLength(0);
    }
  });

  it('import_contact_list sends fire_triggers only when given', async () => {
    reply.data = { purpose: 'audience', list_id: 'cl_1', fire_triggers: true };
    const withFire = await call('import_contact_list', {
      confirm: true,
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
      tag_names: ['Walk list'],
      fire_triggers: true,
    });
    expect((withFire.request.body as Record<string, unknown>).fire_triggers).toBe(true);
    const without = await call('import_contact_list', {
      confirm: true,
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
    });
    expect(without.request.body).not.toHaveProperty('fire_triggers');
  });

  it('import_contact_list sends tag_ids, tag_names, and tags_column', async () => {
    reply.data = { purpose: 'audience', list_id: 'cl_1' };
    const { request } = await call('import_contact_list', {
      confirm: true,
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
      tag_ids: ['t1'],
      tag_names: ['Walk list'],
      tags_column: 'Tags',
    });
    expect(request.path).toBe('/v1/contact-lists/import');
    expect(request.body).toEqual({
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
      tag_ids: ['t1'],
      tag_names: ['Walk list'],
      tags_column: 'Tags',
    });
  });

  it('describes ANY versus ALL and the list consent rule on create_project', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'create_project')!;
    const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.tag_ids?.description).toContain('ANY');
    expect(props.require_tag_ids?.description).toContain('ALL');
    expect(tool.description).toContain('only sent to through a list row the sender can use');
    expect(props.tag_ids?.description).not.toContain('survey');
  });
});
