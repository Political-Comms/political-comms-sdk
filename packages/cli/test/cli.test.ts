import { describe, expect, it, vi } from 'vitest';
import { PoliticalCommsError } from '@political-comms/sdk';
import { main, table, kv, type CliClient, type CliIO } from '../src/cli';

function makeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err };
}

function ok<T>(data: T) {
  return Promise.resolve({ success: true, data });
}

function makeClient(overrides: Partial<Record<keyof CliClient, unknown>> = {}): CliClient {
  const base: Record<string, unknown> = {
    listOrganizations: vi.fn(() => ok([{ id: 'org_1', display_name: 'Civic Action Fund', status: 'active' }])),
    getHierarchy: vi.fn(() =>
      ok({ id: 'org_1', display_name: 'Civic Action Fund', children: [{ id: 'org_2', display_name: 'River City' }] }),
    ),
    listProjects: vi.fn(() => ok([{ id: 'proj_1', name: 'GOTV', campaign_name: 'Fall', org_name: 'Civic Action Fund' }])),
    getProject: vi.fn(() => ok({ id: 'proj_1', name: 'GOTV', status: 'draft' })),
    createProject: vi.fn(() => ok({ id: 'proj_9', status: 'draft' })),
    testProject: vi.fn(() => ok({ project_id: 'proj_1', tests_sent: 1 })),
    scheduleProject: vi.fn(() => ok({ id: 'proj_1', status: 'scheduled', scheduled_at: '2026-11-03T09:00:00' })),
    unscheduleProject: vi.fn(() => ok({ id: 'proj_1', status: 'draft' })),
    copyProject: vi.fn(() => ok({ project_id: 'proj_2', name: 'GOTV_v2', status: 'draft' })),
    listContactLists: vi.fn(() => ok([{ id: 'cl_1', list_name: 'Voters', contact_count: 1200, status: 'ready' }])),
    getContactList: vi.fn(() => ok({ id: 'cl_1', list_name: 'Voters' })),
    deleteContactList: vi.fn(() => ok({ list_id: 'cl_1', name: 'Voters', deleted: true })),
    listConversations: vi.fn(() =>
      ok({
        data: [
          {
            conversation_id: 'conv_1',
            status: 'active',
            from: '+15559876543',
            to: '+15551234567',
            last_inbound_at: '2026-09-06T00:00:00Z',
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    ),
    getConversation: vi.fn(() =>
      ok({ conversation_id: 'conv_1', status: 'active', from: '+15559876543', to: '+15551234567' }),
    ),
    listConversationMessages: vi.fn(() =>
      ok({
        data: [{ message_id: 'msg_1', direction: 'inbound', status: 'received', text: 'Who is this?' }],
        has_more: false,
        next_cursor: null,
      }),
    ),
    replyToConversation: vi.fn(() =>
      ok({
        message_id: 'msg_2',
        conversation_id: 'conv_1',
        project_id: 'proj_1',
        from: '+15559876543',
        to: '+15551234567',
        text: 'Thanks for reaching out',
        created_at: '2026-09-07T10:00:00.000Z',
      }),
    ),
    listMedia: vi.fn(() => ok([{ id: 'media_1', name: 'rally-photo.jpg', status: 'ready', org_name: 'Civic Action Fund' }])),
    getMedia: vi.fn(() => ok({ media_id: 'media_1', name: 'rally-photo.jpg', status: 'ready' })),
    deleteMedia: vi.fn(() => ok({ media_id: 'media_1', name: 'rally-photo.jpg', deleted: true })),
    getMessageStats: vi.fn(() => ok({ totals: { sent: 10 }, daily: [] })),
    getLedgerUsage: vi.fn(() => ok({ organization_name: 'Civic Action Fund', totals: { total_cost: 12.5 } })),
    listEmailTemplates: vi.fn(() =>
      ok({
        data: [
          {
            id: 'tpl_1',
            name: 'GOTV',
            content: { subject: 'Vote Tuesday', html: '<p>Vote</p>', editor: 'html' },
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    ),
    getEmailTemplate: vi.fn(() =>
      ok({
        id: 'tpl_1',
        name: 'GOTV',
        description: null,
        content: { subject: 'Vote Tuesday', preheader: null, html: '<p>Vote</p>', editor: 'html' },
        updated_at: '2026-09-01T00:00:00Z',
      }),
    ),
    getEmailTemplateDraft: vi.fn(() =>
      ok({
        id: 'draft_1',
        status: 'ready',
        subject: 'Vote Tuesday',
        preheader: null,
        error_code: null,
        error_message: null,
        html: '<p>Vote</p>',
        completed_at: '2026-09-01T00:01:00Z',
      }),
    ),
    getEmailListImport: vi.fn(() =>
      ok({
        id: 'imp_1',
        status: 'completed',
        name: 'August donors',
        file_name: 'donors.csv',
        headers: ['Email', 'First Name'],
        recognized_provider: 'mailchimp',
        error_message: null,
        summary: { imported: 1200, rejected: 3 },
        completed_at: '2026-09-01T00:05:00Z',
      }),
    ),
    ...overrides,
  };
  return base as unknown as CliClient;
}

function deps(client: CliClient, io: CliIO) {
  return { createClient: () => client, io };
}

describe('argument parsing', () => {
  it('prints help and exits 0 with --help', async () => {
    const { io, out } = makeIO();
    const code = await main(['--help'], deps(makeClient(), io));
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('Usage:');
  });

  it('exits 2 with help on no command', async () => {
    const { io, out } = makeIO();
    const code = await main([], deps(makeClient(), io));
    expect(code).toBe(2);
    expect(out.join('\n')).toContain('Usage:');
  });

  it('exits 2 on unknown flags', async () => {
    const { io, err } = makeIO();
    const code = await main(['orgs', 'list', '--bogus'], deps(makeClient(), io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('Usage:');
  });

  it('exits 2 on unknown command', async () => {
    const { io, err } = makeIO();
    const code = await main(['frobnicate'], deps(makeClient(), io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('Unknown command: frobnicate');
  });

  it('exits 2 when projects create is missing required flags', async () => {
    const client = makeClient();
    const { io, err } = makeIO();
    const code = await main(['projects', 'create', '--name', 'X'], deps(client, io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--organization-id');
    expect(client.createProject).not.toHaveBeenCalled();
  });

  it('exits 2 when schedule is missing --send-at', async () => {
    const { io, err } = makeIO();
    const code = await main(['projects', 'schedule', 'proj_1', '--timezone', 'America/New_York'], deps(makeClient(), io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--send-at');
  });
});

describe('commands', () => {
  it('auth check prints a friendly confirmation', async () => {
    const { io, out } = makeIO();
    const code = await main(['auth', 'check'], deps(makeClient(), io));
    expect(code).toBe(0);
    expect(out[0]).toBe('Credential OK. 1 organization(s) visible.');
    expect(out[1]).toContain('Civic Action Fund');
  });

  it('orgs list renders an aligned table', async () => {
    const { io, out } = makeIO();
    const code = await main(['orgs', 'list'], deps(makeClient(), io));
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('ID');
    expect(text).toContain('NAME');
    expect(text).toContain('org_1');
    expect(text).toContain('Civic Action Fund');
  });

  it('hierarchy renders an indented tree', async () => {
    const { io, out } = makeIO();
    const code = await main(['hierarchy'], deps(makeClient(), io));
    expect(code).toBe(0);
    expect(out[0]).toBe('- Civic Action Fund (org_1)');
    expect(out[1]).toBe('  - River City (org_2)');
  });

  it('--json prints the raw response', async () => {
    const { io, out } = makeIO();
    const code = await main(['projects', 'list', '--json'], deps(makeClient(), io));
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.success).toBe(true);
    expect(parsed.data[0].id).toBe('proj_1');
  });

  it('projects create maps flags to the createProject request body', async () => {
    const client = makeClient();
    const { io } = makeIO();
    const code = await main(
      [
        'projects', 'create',
        '--name', 'GOTV reminder',
        '--organization-id', 'org_1',
        '--campaign-id', 'camp_1',
        '--brand-id', 'brand_1',
        '--protocol', 'sms',
        '--phone-number-id', 'pn_1',
        '--phone-number-id', 'pn_2',
        '--contact-list-id', 'cl_1',
        '--body', 'Polls are open until 8pm.',
      ],
      deps(client, io),
    );
    expect(code).toBe(0);
    expect(client.createProject).toHaveBeenCalledWith({
      organization_id: 'org_1',
      channel: undefined,
      brand_id: 'brand_1',
      campaign_id: 'camp_1',
      toll_free_verification_id: undefined,
      phone_number_ids: ['pn_1', 'pn_2'],
      name: 'GOTV reminder',
      protocol: 'sms',
      contact_list_ids: ['cl_1'],
      suppression_list_ids: undefined,
      media_ids: undefined,
      message_text: 'Polls are open until 8pm.',
    });
  });

  it('projects test maps --phone flags to test_contacts', async () => {
    const client = makeClient();
    const { io } = makeIO();
    const code = await main(['projects', 'test', 'proj_1', '--phone', '+15555550100'], deps(client, io));
    expect(code).toBe(0);
    expect(client.testProject).toHaveBeenCalledWith('proj_1', {
      test_contacts: [{ phone: '+15555550100' }],
    });
  });

  it('projects schedule maps --send-at and --timezone', async () => {
    const client = makeClient();
    const { io } = makeIO();
    const code = await main(
      ['projects', 'schedule', 'proj_1', '--send-at', '2026-11-03T09:00:00', '--timezone', 'America/New_York'],
      deps(client, io),
    );
    expect(code).toBe(0);
    expect(client.scheduleProject).toHaveBeenCalledWith('proj_1', {
      scheduled_at: '2026-11-03T09:00:00',
      scheduled_timezone: 'America/New_York',
    });
  });

  it('projects schedule omits daily_cap_bypass unless the flag is passed', async () => {
    // Absent means pause at the brand's daily carrier limit - the safe default.
    // The CLI must not send the field at all rather than sending false.
    const client = makeClient();
    const { io } = makeIO();
    await main(
      ['projects', 'schedule', 'proj_1', '--send-at', '2026-11-03T09:00:00', '--timezone', 'America/New_York'],
      deps(client, io),
    );
    expect(client.scheduleProject).toHaveBeenCalledWith('proj_1', {
      scheduled_at: '2026-11-03T09:00:00',
      scheduled_timezone: 'America/New_York',
    });
  });

  it('projects schedule sends daily_cap_bypass when --daily-cap-bypass is passed', async () => {
    const client = makeClient();
    const { io } = makeIO();
    const code = await main(
      [
        'projects',
        'schedule',
        'proj_1',
        '--send-at',
        '2026-11-03T09:00:00',
        '--timezone',
        'America/New_York',
        '--daily-cap-bypass',
      ],
      deps(client, io),
    );
    expect(code).toBe(0);
    expect(client.scheduleProject).toHaveBeenCalledWith('proj_1', {
      scheduled_at: '2026-11-03T09:00:00',
      scheduled_timezone: 'America/New_York',
      daily_cap_bypass: true,
    });
  });

  it('projects copy calls copyProject and reports the new project', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['projects', 'copy', 'proj_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.copyProject).toHaveBeenCalledWith('proj_1');
    expect(out[0]).toBe('Copied project proj_1 to proj_2 (name: GOTV_v2, status: draft).');
  });

  it('exits 2 when projects copy is missing the id', async () => {
    const client = makeClient();
    const { io, err } = makeIO();
    const code = await main(['projects', 'copy'], deps(client, io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('projects copy <id>');
    expect(client.copyProject).not.toHaveBeenCalled();
  });

  it('contact-lists delete calls deleteContactList and confirms', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['contact-lists', 'delete', 'cl_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.deleteContactList).toHaveBeenCalledWith('cl_1');
    expect(out[0]).toBe('Deleted contact list Voters.');
  });

  it('media list renders a table', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['media', 'list', '--organization-id', 'org_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.listMedia).toHaveBeenCalledWith({ organization_id: 'org_1', brand_id: undefined });
    const text = out.join('\n');
    expect(text).toContain('ID');
    expect(text).toContain('media_1');
    expect(text).toContain('rally-photo.jpg');
  });

  it('media get prints key-value details', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['media', 'get', 'media_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.getMedia).toHaveBeenCalledWith('media_1');
    expect(out.join('\n')).toContain('rally-photo.jpg');
  });

  it('media delete calls deleteMedia and confirms', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['media', 'delete', 'media_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.deleteMedia).toHaveBeenCalledWith('media_1');
    expect(out[0]).toBe('Deleted media rally-photo.jpg.');
  });

  it('exits 2 on an unknown media subcommand', async () => {
    const { io, err } = makeIO();
    const code = await main(['media', 'frobnicate'], deps(makeClient(), io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('media <list|get|delete>');
  });

  it('conversations list forwards filters and renders a table', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(
      ['conversations', 'list', '--project', 'proj_1', '--since', '2026-09-01T00:00:00Z', '--include-test'],
      deps(client, io),
    );
    expect(code).toBe(0);
    expect(client.listConversations).toHaveBeenCalledWith({
      project_id: 'proj_1',
      updated_since: '2026-09-01T00:00:00Z',
      include_test: true,
      limit: undefined,
      cursor: undefined,
    });
    const text = out.join('\n');
    expect(text).toContain('conv_1');
    expect(text).toContain('active');
  });

  it('conversations get prints key-value details', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['conversations', 'get', 'conv_1'], deps(client, io));
    expect(code).toBe(0);
    expect(client.getConversation).toHaveBeenCalledWith('conv_1');
    expect(out.join('\n')).toContain('conv_1');
  });

  it('conversations messages lists messages in a thread', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['conversations', 'messages', 'conv_1', '--limit', '10'], deps(client, io));
    expect(code).toBe(0);
    expect(client.listConversationMessages).toHaveBeenCalledWith('conv_1', { limit: 10, cursor: undefined });
    expect(out.join('\n')).toContain('Who is this?');
  });

  it('conversations reply sends the text and confirms', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(
      ['conversations', 'reply', 'conv_1', '--text', 'Thanks for reaching out'],
      deps(client, io),
    );
    expect(code).toBe(0);
    expect(client.replyToConversation).toHaveBeenCalledWith('conv_1', { text: 'Thanks for reaching out' });
    expect(out[0]).toBe('Sent reply msg_2 in conversation conv_1.');
  });

  it('exits 2 when conversations reply is missing --text', async () => {
    const client = makeClient();
    const { io, err } = makeIO();
    const code = await main(['conversations', 'reply', 'conv_1'], deps(client, io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--text');
    expect(client.replyToConversation).not.toHaveBeenCalled();
  });

  it('exits 2 when conversations reply is missing the id', async () => {
    const client = makeClient();
    const { io, err } = makeIO();
    const code = await main(['conversations', 'reply'], deps(client, io));
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('conversations reply <id>');
    expect(client.replyToConversation).not.toHaveBeenCalled();
  });

  it('stats messages passes --from and --to as startDate and endDate', async () => {
    const client = makeClient();
    const { io } = makeIO();
    const code = await main(['stats', 'messages', '--from', '2026-06-01', '--to', '2026-06-30'], deps(client, io));
    expect(code).toBe(0);
    expect(client.getMessageStats).toHaveBeenCalledWith({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      organizationId: undefined,
      brandId: undefined,
      campaignId: undefined,
    });
  });
});

describe('error handling', () => {
  it('exits 1 and prints code, message, and hint on API errors', async () => {
    const client = makeClient({
      listOrganizations: vi.fn(() =>
        Promise.reject(new PoliticalCommsError('Invalid API key', 'UNAUTHORIZED', 401, undefined)),
      ),
    });
    const { io, err } = makeIO();
    const code = await main(['auth', 'check'], deps(client, io));
    expect(code).toBe(1);
    expect(err[0]).toBe('Error UNAUTHORIZED (HTTP 401): Invalid API key');
    expect(err[1]).toContain('https://politicalcomms.com/errors.md');
  });

  it('exits 1 with a clear message when no API key is available', async () => {
    const { io, err } = makeIO();
    const code = await main(['orgs', 'list'], { io, env: {} });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('POLITICAL_COMMS_API_KEY');
  });
});

describe('formatting helpers', () => {
  it('table aligns columns and handles missing values', () => {
    const text = table(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'long-id', name: undefined },
      ],
      [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
      ],
    );
    expect(text.split('\n')).toEqual(['ID       NAME', 'a        Alpha', 'long-id']);
  });

  it('table renders a placeholder for empty results', () => {
    expect(table([], [{ key: 'id', header: 'ID' }])).toBe('(no results)');
  });

  it('kv aligns keys', () => {
    expect(kv({ id: 'x', list_name: 'Voters' }).split('\n')).toEqual(['id         x', 'list_name  Voters']);
  });
});

describe('email read commands', () => {
  it('email templates list renders the subject from the nested content object', async () => {
    const client = makeClient();
    const { io, out } = makeIO();
    const code = await main(['email', 'templates', 'list', '--search', 'gotv'], deps(client, io));

    expect(code).toBe(0);
    expect(client.listEmailTemplates).toHaveBeenCalledWith({ limit: undefined, search: 'gotv' });
    expect(out.join('\n')).toContain('SUBJECT');
    expect(out.join('\n')).toContain('Vote Tuesday');
  });

  it('email templates get reports the html size rather than dumping the body', async () => {
    const { io, out } = makeIO();
    const code = await main(['email', 'templates', 'get', 'tpl_1'], deps(makeClient(), io));

    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('html_bytes');
    expect(text).not.toContain('<p>Vote</p>');
  });

  it('email templates get --json includes the html', async () => {
    const { io, out } = makeIO();
    const code = await main(['email', 'templates', 'get', 'tpl_1', '--json'], deps(makeClient(), io));

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('<p>Vote</p>');
  });

  it('exits 2 when email templates get is missing the id', async () => {
    const { io, err } = makeIO();
    const code = await main(['email', 'templates', 'get'], deps(makeClient(), io));

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('email templates get <id>');
  });

  it('exits 2 on a write subcommand: email writes belong in an SDK script', async () => {
    const { io, err } = makeIO();
    const code = await main(['email', 'templates', 'create'], deps(makeClient(), io));

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('email templates <list|get>');
  });
});
