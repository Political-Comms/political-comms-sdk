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
});

type Recorded = { method: string; path: string; body: unknown };

/** Runs the built server against a local API stub, so a tool call's HTTP request can be asserted. */
describe('political-comms MCP server tag requests', () => {
  let client: Client;
  let api: Server;
  const requests: Recorded[] = [];
  const reply: { data: unknown } = { data: {} };

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: reply.data }));
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

    const byList = await call('add_tag_contacts', { confirm: true, id: 'tag_1', contact_list_id: 'cl_1' });
    expect(byList.request.body).toEqual({ contact_list_id: 'cl_1' });
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
  });
});
