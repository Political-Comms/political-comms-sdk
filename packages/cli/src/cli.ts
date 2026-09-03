import { parseArgs } from 'node:util';
import { PoliticalCommsClient, PoliticalCommsError } from '@political-comms/sdk';
import type { ScheduleTimezone } from '@political-comms/sdk';

/** The subset of the SDK the CLI uses. Injectable for tests. */
export type CliClient = Pick<
  PoliticalCommsClient,
  | 'listOrganizations'
  | 'getHierarchy'
  | 'listProjects'
  | 'getProject'
  | 'createProject'
  | 'testProject'
  | 'scheduleProject'
  | 'unscheduleProject'
  | 'copyProject'
  | 'archiveProject'
  | 'listContactLists'
  | 'getContactList'
  | 'deleteContactList'
  | 'listMedia'
  | 'getMedia'
  | 'deleteMedia'
  | 'getMessageStats'
  | 'getLedgerUsage'
  | 'listEmailDomains'
  | 'listEmailSenders'
  | 'listEmailLists'
  | 'listEmailSuppressions'
  | 'listEmailCampaigns'
  | 'getEmailCampaign'
  | 'getEmailCampaignStats'
  | 'listEmailTemplates'
  | 'getEmailTemplate'
  | 'getEmailTemplateDraft'
  | 'getEmailListImport'
>;

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface CliDeps {
  createClient?: (apiKey?: string) => CliClient;
  io?: CliIO;
  env?: NodeJS.ProcessEnv;
}

export const HELP = `Political Comms CLI

Usage:
  political-comms <command> [options]

Commands:
  auth check                       Verify the API key by listing organizations
  orgs list                        List organizations visible to the key
  hierarchy                        Show the organization hierarchy
  projects list                    List projects
  projects get <id>                Show one project
  projects create                  Create a project (see create flags)
  projects test <id>               Send a test message (--phone, repeatable)
  projects schedule <id>           Schedule a send (--send-at, --timezone,
                                   [--daily-cap-bypass])
  projects unschedule <id>         Remove a schedule
  projects copy <id>               Copy a project (drops lists, schedule, stats)
  projects archive <id>            Archive a completed project
  contact-lists list               List contact lists
  contact-lists get <id>           Show one contact list
  contact-lists delete <id>        Delete an unused contact list
  media list                       List media files
  media get <id>                   Show one media file
  media delete <id>                Delete an unused media file
  stats messages                   Message stats (--from, --to; default last 30 days)
  usage                            Billing usage (--from, --to; default last 30 days)
  email domains list               List email sending domains (early access)
  email senders list               List email sender identities (early access)
  email lists list                 List email lists (early access)
  email suppressions list          List email suppressions (--scope) (early access)
  email campaigns list             List email campaigns (--status) (early access)
  email campaigns get <id>         Show one email campaign, including blockers
  email campaigns stats <id>       Show email campaign report tiles
  email templates list             List email templates (--search) (early access)
  email templates get <id>         Show one email template (HTML only with --json)
  email drafts get <id>            Show one AI draft's status (HTML only with --json)
  email imports get <id>           Show one email list import

Email commands are early access: every one returns 403 EMAIL_EARLY_ACCESS until
the email product reaches general availability. Template and draft HTML is
printed only with --json, so a body never floods the terminal.

Create flags (projects create):
  --name <name>                    Project name (required)
  --organization-id <id>           Owning organization (required)
  --protocol <sms|mms>             Message protocol (required)
  --phone-number-id <id>           Sending number, repeatable (required)
  --contact-list-id <id>           Contact list, repeatable (required)
  --body <text>                    Message text (required)
  --campaign-id <id>               10DLC campaign
  --brand-id <id>                  10DLC brand
  --channel <10dlc|toll-free>      Messaging channel (default 10dlc)
  --toll-free-verification-id <id> Toll-free verification (channel=toll-free)
  --suppression-list-id <id>       Suppression list, repeatable
  --media-id <id>                  Media file for MMS, repeatable

Global options:
  --api-key <key>                  API key (default: POLITICAL_COMMS_API_KEY)
  --json                           Print the raw JSON response
  -h, --help                       Show this help

Exit codes: 0 success, 1 API error, 2 usage error`;

const ERROR_HINT = 'Hint: error codes are documented at https://politicalcomms.com/errors.md';

const PARSE_OPTIONS = {
  json: { type: 'boolean', default: false },
  'api-key': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
  name: { type: 'string' },
  'organization-id': { type: 'string' },
  'brand-id': { type: 'string' },
  'campaign-id': { type: 'string' },
  'toll-free-verification-id': { type: 'string' },
  channel: { type: 'string' },
  protocol: { type: 'string' },
  'phone-number-id': { type: 'string', multiple: true },
  'contact-list-id': { type: 'string', multiple: true },
  'suppression-list-id': { type: 'string', multiple: true },
  'media-id': { type: 'string', multiple: true },
  body: { type: 'string' },
  phone: { type: 'string', multiple: true },
  'send-at': { type: 'string' },
  timezone: { type: 'string' },
  'daily-cap-bypass': { type: 'boolean', default: false },
  from: { type: 'string' },
  to: { type: 'string' },
  scope: { type: 'string' },
  status: { type: 'string' },
  limit: { type: 'string' },
  search: { type: 'string' },
} as const;

class UsageError extends Error {}

type Flags = {
  [K in keyof typeof PARSE_OPTIONS]?: (typeof PARSE_OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof PARSE_OPTIONS)[K] extends { type: 'boolean' }
      ? boolean
      : string;
};

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io: CliIO = deps.io ?? {
    out: (text) => process.stdout.write(text + '\n'),
    err: (text) => process.stderr.write(text + '\n'),
  };
  const env = deps.env ?? process.env;

  let flags: Flags;
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, options: PARSE_OPTIONS, allowPositionals: true, strict: true });
    flags = parsed.values as Flags;
    positionals = parsed.positionals;
  } catch (cause) {
    io.err(cause instanceof Error ? cause.message : String(cause));
    io.err('');
    io.err(HELP);
    return 2;
  }

  if (flags.help || positionals.length === 0) {
    io.out(HELP);
    return flags.help ? 0 : 2;
  }

  let client: CliClient;
  try {
    client = deps.createClient
      ? deps.createClient(flags['api-key'])
      : new PoliticalCommsClient({ apiKey: flags['api-key'] ?? env.POLITICAL_COMMS_API_KEY });
  } catch (cause) {
    io.err(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }

  try {
    return await dispatch(client, positionals, flags, io);
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.err(cause.message);
      io.err('');
      io.err(HELP);
      return 2;
    }
    if (cause instanceof PoliticalCommsError) {
      io.err(`Error ${cause.code} (HTTP ${cause.statusCode}): ${cause.message}`);
      io.err(ERROR_HINT);
      return 1;
    }
    io.err(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

async function dispatch(client: CliClient, positionals: string[], flags: Flags, io: CliIO): Promise<number> {
  const [command, sub, arg, arg2] = positionals;

  switch (command) {
    case 'auth': {
      requireSub(sub, ['check'], 'auth');
      const result = await client.listOrganizations();
      if (flags.json) return printJson(io, result);
      const orgs = result.data ?? [];
      io.out(`Credential OK. ${orgs.length} organization(s) visible.`);
      for (const org of orgs) io.out(`  ${str(org.display_name) || str(org.id)}`);
      return 0;
    }

    case 'orgs': {
      requireSub(sub, ['list'], 'orgs');
      const result = await client.listOrganizations();
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data ?? [], [
          { key: 'id', header: 'ID' },
          { key: 'display_name', header: 'NAME' },
          { key: 'status', header: 'STATUS' },
          { key: 'parent_org_name', header: 'PARENT' },
        ]),
      );
      return 0;
    }

    case 'hierarchy': {
      const result = await client.getHierarchy({ organizationId: flags['organization-id'] });
      if (flags.json) return printJson(io, result);
      printHierarchy(result.data, io);
      return 0;
    }

    case 'projects':
      return projectsCommand(client, sub, arg, flags, io);

    case 'contact-lists': {
      requireSub(sub, ['list', 'get', 'delete'], 'contact-lists');
      if (sub === 'list') {
        const result = await client.listContactLists({
          organization_id: flags['organization-id'],
          brand_id: flags['brand-id'],
        });
        if (flags.json) return printJson(io, result);
        io.out(
          table(result.data ?? [], [
            { key: 'id', header: 'ID' },
            { key: 'list_name', header: 'NAME' },
            { key: 'contact_count', header: 'CONTACTS' },
            { key: 'status', header: 'STATUS' },
          ]),
        );
        return 0;
      }
      if (sub === 'delete') {
        const id = requireArg(arg, 'contact-lists delete <id>');
        const result = await client.deleteContactList(id);
        if (flags.json) return printJson(io, result);
        io.out(`Deleted contact list ${str(result.data?.name) || id}.`);
        return 0;
      }
      const id = requireArg(arg, 'contact-lists get <id>');
      const result = await client.getContactList(id);
      if (flags.json) return printJson(io, result);
      io.out(kv(result.data));
      return 0;
    }

    case 'media': {
      requireSub(sub, ['list', 'get', 'delete'], 'media');
      if (sub === 'list') {
        const result = await client.listMedia({
          organization_id: flags['organization-id'],
          brand_id: flags['brand-id'],
        });
        if (flags.json) return printJson(io, result);
        io.out(
          table(result.data ?? [], [
            { key: 'id', header: 'ID' },
            { key: 'name', header: 'NAME' },
            { key: 'status', header: 'STATUS' },
            { key: 'org_name', header: 'ORG' },
          ]),
        );
        return 0;
      }
      if (sub === 'delete') {
        const id = requireArg(arg, 'media delete <id>');
        const result = await client.deleteMedia(id);
        if (flags.json) return printJson(io, result);
        io.out(`Deleted media ${str(result.data?.name) || id}.`);
        return 0;
      }
      const id = requireArg(arg, 'media get <id>');
      const result = await client.getMedia(id);
      if (flags.json) return printJson(io, result);
      io.out(kv(result.data));
      return 0;
    }

    case 'stats': {
      requireSub(sub, ['messages'], 'stats');
      const range = dateRange(flags);
      const result = await client.getMessageStats({
        startDate: range.start,
        endDate: range.end,
        organizationId: flags['organization-id'],
        brandId: flags['brand-id'],
        campaignId: flags['campaign-id'],
      });
      if (flags.json) return printJson(io, result);
      io.out(`Message stats ${range.start} to ${range.end}`);
      io.out('');
      io.out('Totals:');
      io.out(indent(kv(result.data?.totals ?? {}), 2));
      const daily = Array.isArray(result.data?.daily) ? result.data.daily : [];
      io.out('');
      io.out(`Daily rows: ${daily.length}`);
      return 0;
    }

    case 'usage': {
      const range = dateRange(flags);
      const result = await client.getLedgerUsage({
        startDate: range.start,
        endDate: range.end,
        organizationId: flags['organization-id'],
      });
      if (flags.json) return printJson(io, result);
      io.out(`Usage ${range.start} to ${range.end}`);
      if (result.data?.organization_name) io.out(`Organization: ${str(result.data.organization_name)}`);
      io.out('');
      io.out('Totals:');
      io.out(indent(kv(result.data?.totals ?? {}), 2));
      const categories = Array.isArray(result.data?.by_category) ? result.data.by_category : [];
      if (categories.length > 0) {
        io.out('');
        io.out('By category:');
        io.out(indent(table(categories, autoColumns(categories)), 2));
      }
      return 0;
    }

    case 'email':
      return emailCommand(client, sub, arg, arg2, flags, io);

    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

/**
 * Email commands (early access).
 *
 * Read-only: the write side of /v1/email (creating domains, importing
 * contacts, scheduling campaigns, saving templates) is multi-step and belongs
 * in a script against the SDK, not in flag-per-field shell invocations. That
 * covers requesting an AI draft and starting a list import too: both cost
 * money or write contacts, and both need a poll loop the SDK already has.
 * Every call here returns 403 EMAIL_EARLY_ACCESS until the product reaches
 * general availability.
 */
async function emailCommand(
  client: CliClient,
  sub: string | undefined,
  arg: string | undefined,
  arg2: string | undefined,
  flags: Flags,
  io: CliIO,
): Promise<number> {
  requireSub(
    sub,
    ['domains', 'senders', 'lists', 'suppressions', 'campaigns', 'templates', 'drafts', 'imports'],
    'email',
  );
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  if (limit !== undefined && !Number.isInteger(limit)) {
    throw new UsageError('--limit must be an integer');
  }

  switch (sub) {
    case 'domains': {
      requireSub(arg, ['list'], 'email domains');
      const result = await client.listEmailDomains({ limit });
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data?.data ?? [], [
          { key: 'id', header: 'ID' },
          { key: 'domain', header: 'DOMAIN' },
          { key: 'status', header: 'STATUS' },
        ]),
      );
      return 0;
    }

    case 'senders': {
      requireSub(arg, ['list'], 'email senders');
      const result = await client.listEmailSenders();
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data?.data ?? [], [
          { key: 'id', header: 'ID' },
          { key: 'from_address', header: 'FROM' },
          { key: 'from_name', header: 'NAME' },
          { key: 'status', header: 'STATUS' },
        ]),
      );
      return 0;
    }

    case 'lists': {
      requireSub(arg, ['list'], 'email lists');
      const result = await client.listEmailLists({ limit });
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data?.data ?? [], [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'NAME' },
          { key: 'source_type', header: 'SOURCE' },
          { key: 'status', header: 'STATUS' },
        ]),
      );
      return 0;
    }

    case 'suppressions': {
      requireSub(arg, ['list'], 'email suppressions');
      const result = await client.listEmailSuppressions({
        limit,
        scope: flags.scope as 'org' | 'identity' | 'list' | undefined,
      });
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data?.data ?? [], [
          { key: 'email', header: 'EMAIL' },
          { key: 'scope', header: 'SCOPE' },
          { key: 'reason', header: 'REASON' },
          { key: 'suppressed_at', header: 'SUPPRESSED' },
        ]),
      );
      return 0;
    }

    case 'templates': {
      requireSub(arg, ['list', 'get'], 'email templates');
      if (arg === 'list') {
        const result = await client.listEmailTemplates({ limit, search: flags.search });
        if (flags.json) return printJson(io, result);
        io.out(
          table(
            (result.data?.data ?? []).map((template) => ({
              ...template,
              subject: template.content?.subject,
            })),
            [
              { key: 'id', header: 'ID' },
              { key: 'name', header: 'NAME' },
              { key: 'subject', header: 'SUBJECT' },
              { key: 'updated_at', header: 'UPDATED' },
            ],
          ),
        );
        return 0;
      }
      const id = requireArg(arg2, 'email templates get <id>');
      const result = await client.getEmailTemplate(id);
      if (flags.json) return printJson(io, result);
      const template = result.data;
      // The HTML body is megabytes wide; --json is the way to get it.
      io.out(
        kv({
          id: template?.id,
          name: template?.name,
          description: template?.description,
          subject: template?.content?.subject,
          preheader: template?.content?.preheader,
          html_bytes: template?.content?.html?.length ?? 0,
          updated_at: template?.updated_at,
        }),
      );
      return 0;
    }

    case 'drafts': {
      requireSub(arg, ['get'], 'email drafts');
      const id = requireArg(arg2, 'email drafts get <id>');
      const result = await client.getEmailTemplateDraft(id);
      if (flags.json) return printJson(io, result);
      const draft = result.data;
      io.out(
        kv({
          id: draft?.id,
          status: draft?.status,
          subject: draft?.subject,
          preheader: draft?.preheader,
          error_code: draft?.error_code,
          error_message: draft?.error_message,
          html_bytes: draft?.html?.length ?? 0,
          completed_at: draft?.completed_at,
        }),
      );
      return 0;
    }

    case 'imports': {
      requireSub(arg, ['get'], 'email imports');
      const id = requireArg(arg2, 'email imports get <id>');
      const result = await client.getEmailListImport(id);
      if (flags.json) return printJson(io, result);
      const record = result.data;
      io.out(
        kv({
          id: record?.id,
          status: record?.status,
          email_list_id: record?.email_list_id,
          file_name: record?.file_name,
          headers: record?.headers?.length ?? 0,
          recognized_provider: record?.recognized_provider,
          error_message: record?.error_message,
          completed_at: record?.completed_at,
        }),
      );
      if (record?.summary) {
        io.out('');
        io.out('Summary:');
        io.out(indent(kv(record.summary), 2));
      }
      return 0;
    }

    case 'campaigns':
      return emailCampaignsCommand(client, arg, arg2, flags, io);

    default:
      throw new UsageError(`Unknown email command: ${String(sub)}`);
  }
}

async function emailCampaignsCommand(
  client: CliClient,
  arg: string | undefined,
  arg2: string | undefined,
  flags: Flags,
  io: CliIO,
): Promise<number> {
  requireSub(arg, ['list', 'get', 'stats'], 'email campaigns');
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);

  if (arg === 'list') {
    const result = await client.listEmailCampaigns({
      limit,
      status: flags.status as never,
    });
    if (flags.json) return printJson(io, result);
    io.out(
      table(result.data?.data ?? [], [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'status', header: 'STATUS' },
        { key: 'audience_count', header: 'AUDIENCE' },
      ]),
    );
    return 0;
  }

  const id = requireArg(arg2, `email campaigns ${arg} <id>`);

  if (arg === 'get') {
    const result = await client.getEmailCampaign(id);
    if (flags.json) return printJson(io, result);
    const campaign = result.data;
    io.out(kv({
      id: campaign?.id,
      name: campaign?.name,
      status: campaign?.status,
      audience_count: campaign?.audience_count,
      scheduled_at: campaign?.scheduled_at,
      pause_reason: campaign?.pause_reason,
    }));
    const blocked = campaign?.blocked ?? [];
    if (blocked.length > 0) {
      io.out('');
      io.out('Blocked from scheduling:');
      for (const item of blocked) io.out(`  ${item.code}: ${item.message}`);
    }
    return 0;
  }

  const result = await client.getEmailCampaignStats(id);
  if (flags.json) return printJson(io, result);
  io.out(`Campaign ${str(result.data?.campaign_id)} (${str(result.data?.status)})`);
  io.out('');
  io.out('Tiles:');
  io.out(indent(kv(result.data?.tiles ?? {}), 2));
  return 0;
}

async function projectsCommand(
  client: CliClient,
  sub: string | undefined,
  arg: string | undefined,
  flags: Flags,
  io: CliIO,
): Promise<number> {
  requireSub(sub, ['list', 'get', 'create', 'test', 'schedule', 'unschedule', 'copy', 'archive'], 'projects');

  switch (sub) {
    case 'list': {
      const result = await client.listProjects({
        organization_id: flags['organization-id'],
        brand_id: flags['brand-id'],
        campaign_id: flags['campaign-id'],
      });
      if (flags.json) return printJson(io, result);
      io.out(
        table(result.data ?? [], [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'NAME' },
          { key: 'campaign_name', header: 'CAMPAIGN' },
          { key: 'org_name', header: 'ORG' },
        ]),
      );
      return 0;
    }

    case 'get': {
      const id = requireArg(arg, 'projects get <id>');
      const result = await client.getProject(id);
      if (flags.json) return printJson(io, result);
      io.out(kv(result.data));
      return 0;
    }

    case 'create': {
      const missing = [
        ['--name', flags.name],
        ['--organization-id', flags['organization-id']],
        ['--protocol', flags.protocol],
        ['--phone-number-id', flags['phone-number-id']?.[0]],
        ['--contact-list-id', flags['contact-list-id']?.[0]],
        ['--body', flags.body],
      ]
        .filter(([, value]) => value === undefined)
        .map(([flag]) => flag);
      if (missing.length > 0) throw new UsageError(`projects create is missing required flags: ${missing.join(', ')}`);
      if (flags.protocol !== 'sms' && flags.protocol !== 'mms') {
        throw new UsageError('--protocol must be sms or mms');
      }
      if (flags.channel !== undefined && flags.channel !== '10dlc' && flags.channel !== 'toll-free') {
        throw new UsageError('--channel must be 10dlc or toll-free');
      }
      const result = await client.createProject({
        organization_id: flags['organization-id']!,
        channel: flags.channel,
        brand_id: flags['brand-id'],
        campaign_id: flags['campaign-id'],
        toll_free_verification_id: flags['toll-free-verification-id'],
        phone_number_ids: flags['phone-number-id']!,
        name: flags.name!,
        protocol: flags.protocol,
        contact_list_ids: flags['contact-list-id']!,
        suppression_list_ids: flags['suppression-list-id'],
        media_ids: flags['media-id'],
        message_text: flags.body!,
      });
      if (flags.json) return printJson(io, result);
      io.out(`Created project ${str(result.data?.id)} (status: ${str(result.data?.status)})`);
      return 0;
    }

    case 'test': {
      const id = requireArg(arg, 'projects test <id>');
      const phones = flags.phone ?? [];
      if (phones.length === 0) throw new UsageError('projects test requires at least one --phone');
      const result = await client.testProject(id, { test_contacts: phones.map((phone) => ({ phone })) });
      if (flags.json) return printJson(io, result);
      io.out(`Queued ${str(result.data?.tests_sent) || phones.length} test message(s) for project ${id}.`);
      return 0;
    }

    case 'schedule': {
      const id = requireArg(arg, 'projects schedule <id>');
      if (!flags['send-at']) throw new UsageError('projects schedule requires --send-at <iso date-time>');
      if (!flags.timezone) throw new UsageError('projects schedule requires --timezone <iana tz>');
      const result = await client.scheduleProject(id, {
        scheduled_at: flags['send-at'],
        scheduled_timezone: parseTimezone(flags.timezone),
        // Opt-in only: omitted means the project pauses at the brand's
        // T-Mobile daily cap, which is the safe default.
        ...(flags['daily-cap-bypass'] ? { daily_cap_bypass: true } : {}),
      });
      if (flags.json) return printJson(io, result);
      io.out(
        `Scheduled project ${id} for ${str(result.data?.scheduled_at) || flags['send-at']} ` +
          `(${str(result.data?.scheduled_timezone) || flags.timezone}).` +
          (result.data?.daily_cap_bypass
            ? ' Sending will not pause at the brand daily carrier limit; over-limit ' +
              'T-Mobile messages may fail and are still billed.'
            : ''),
      );
      return 0;
    }

    case 'unschedule': {
      const id = requireArg(arg, 'projects unschedule <id>');
      const result = await client.unscheduleProject(id);
      if (flags.json) return printJson(io, result);
      io.out(`Unscheduled project ${id} (status: ${str(result.data?.status)}).`);
      return 0;
    }

    case 'copy': {
      const id = requireArg(arg, 'projects copy <id>');
      const result = await client.copyProject(id);
      if (flags.json) return printJson(io, result);
      io.out(
        `Copied project ${id} to ${str(result.data?.project_id)} ` +
          `(name: ${str(result.data?.name)}, status: ${str(result.data?.status)}).`,
      );
      return 0;
    }

    case 'archive': {
      const id = requireArg(arg, 'projects archive <id>');
      const result = await client.archiveProject(id);
      if (flags.json) return printJson(io, result);
      io.out(`Archived project ${id} (status: ${str(result.data?.status)}).`);
      return 0;
    }

    default:
      throw new UsageError(`Unknown projects subcommand: ${sub}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSub(sub: string | undefined, allowed: string[], command: string): void {
  if (!sub || !allowed.includes(sub)) {
    throw new UsageError(`Usage: political-comms ${command} <${allowed.join('|')}>`);
  }
}

/** The six US zones the API accepts. Rejected here so the error names the flag. */
const SCHEDULE_TIMEZONES: readonly ScheduleTimezone[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

function parseTimezone(value: string): ScheduleTimezone {
  const match = SCHEDULE_TIMEZONES.find((zone) => zone === value);
  if (!match) {
    throw new UsageError(
      `--timezone must be one of: ${SCHEDULE_TIMEZONES.join(', ')}`,
    );
  }
  return match;
}

function requireArg(arg: string | undefined, usage: string): string {
  if (!arg) throw new UsageError(`Usage: political-comms ${usage}`);
  return arg;
}

function printJson(io: CliIO, value: unknown): number {
  io.out(JSON.stringify(value, null, 2));
  return 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

export function kv(obj: unknown): string {
  const entries = Object.entries((obj ?? {}) as Record<string, unknown>);
  if (entries.length === 0) return '(empty)';
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `${key.padEnd(width)}  ${str(value)}`).join('\n');
}

export function table(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; header: string }>,
): string {
  if (rows.length === 0) return '(no results)';
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => str(row[col.key]).length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  const out = [line(columns.map((c) => c.header))];
  for (const row of rows) out.push(line(columns.map((c) => str(row[c.key]))));
  return out.join('\n');
}

function autoColumns(rows: Array<Record<string, unknown>>): Array<{ key: string; header: string }> {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return [...keys].map((key) => ({ key, header: key.toUpperCase() }));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRange(flags: Flags): { start: string; end: string } {
  return {
    start: flags.from ?? isoDate(new Date(Date.now() - 30 * 86_400_000)),
    end: flags.to ?? isoDate(new Date()),
  };
}

function printHierarchy(node: unknown, io: CliIO, depth = 0): void {
  const record = (node ?? {}) as Record<string, unknown>;
  const label = str(record.display_name) || str(record.id) || '(unnamed)';
  const suffix = record.display_name && record.id ? ` (${str(record.id)})` : '';
  io.out(`${'  '.repeat(depth)}- ${label}${suffix}`);
  if (Array.isArray(record.brands)) {
    for (const brand of record.brands) {
      const b = (brand ?? {}) as Record<string, unknown>;
      io.out(`${'  '.repeat(depth + 1)}* brand: ${str(b.brand_name) || str(b.id) || '(unnamed)'}`);
    }
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) printHierarchy(child, io, depth + 1);
  }
}
