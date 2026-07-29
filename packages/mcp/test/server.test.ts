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
  'list_contact_lists',
  'get_contact_list',
  'get_message_stats',
  'get_ledger_usage',
  'create_project',
  'test_project',
  'schedule_project',
  'unschedule_project',
  'copy_project',
  'archive_project',
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
        'list_contact_lists',
        'get_contact_list',
        'get_message_stats',
        'get_ledger_usage',
      ].sort(),
    );
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
});
