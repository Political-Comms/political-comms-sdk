import { PoliticalCommsError } from './error';
import type {
  AllProjectStats,
  ApiResponse,
  ArchiveProjectResult,
  Brand,
  Campaign,
  ContactList,
  ContactListAnalysisResult,
  ContactListDetail,
  ContactListImportResult,
  CopyProjectResult,
  CreateProjectRequest,
  CreateProjectResult,
  DeleteContactListResult,
  DeleteMediaResult,
  GetAllProjectStatsQuery,
  GetHierarchyQuery,
  GetLedgerUsageByInitiatorQuery,
  GetLedgerUsageQuery,
  GetMessageStatsQuery,
  HierarchyNode,
  ImportContactListRequest,
  ImportMediaRequest,
  LedgerUsage,
  LedgerUsageByInitiator,
  ListBrandsQuery,
  ListCampaignsQuery,
  ListContactListsQuery,
  ListMediaQuery,
  ListPhoneNumbersQuery,
  ListProjectsQuery,
  ListTollFreeVerificationsQuery,
  ListTrackingDomainsQuery,
  MediaFile,
  MediaFileDetail,
  MediaUsage,
  MediaImportResult,
  MessageStats,
  Organization,
  PhoneNumber,
  Project,
  ProjectDetail,
  ProjectStats,
  RateLimitState,
  RequestOptions,
  ScheduleProjectRequest,
  ScheduleProjectResult,
  TestProjectRequest,
  TestProjectResult,
  TollFreeVerification,
  TollFreeVerificationDetail,
  TrackingDomain,
  UnscheduleProjectResult,
  UpdateProjectRequest,
  UpdateProjectResult,
  // Email (early access)
  AddEmailSuppressionsRequest,
  AddEmailSuppressionsResult,
  BulkUpsertResult,
  CreateEmailCampaignRequest,
  CreateEmailListRequest,
  CreateEmailTemplateRequest,
  CursorPage,
  DeletedResult,
  EmailCampaign,
  EmailCampaignStats,
  EmailContactInput,
  EmailDomain,
  EmailList,
  EmailListContact,
  EmailListImport,
  EmailPageQuery,
  EmailSenderIdentity,
  EmailSuppression,
  EmailTemplate,
  EmailTemplateWithLint,
  ListEmailCampaignsQuery,
  ListEmailContactsQuery,
  ListEmailDomainsQuery,
  ListEmailListsQuery,
  ListEmailSuppressionsQuery,
  ListEmailTemplatesQuery,
  RemoveEmailContactsResult,
  RemoveEmailSuppressionsRequest,
  RemoveEmailSuppressionsResult,
  ScheduleEmailCampaignRequest,
  StartEmailListImportRequest,
  TestEmailCampaignResult,
} from './types';

const DEFAULT_BASE_URL = 'https://api.politicalcomms.com/v1';
/** Default retries after the first attempt, so 5 attempts total. */
const DEFAULT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export interface PoliticalCommsClientOptions {
  /** API key (pc_live_*). Defaults to the POLITICAL_COMMS_API_KEY environment variable. */
  apiKey?: string;
  /** API base URL. Defaults to https://api.politicalcomms.com/v1. */
  baseUrl?: string;
  /**
   * Maximum retries after the first attempt for 429 and 5xx responses.
   * Defaults to 4, so a request is attempted at most 5 times.
   */
  maxRetries?: number;
  /** Custom fetch implementation. Defaults to the global fetch. */
  fetch?: typeof fetch;
}


type QueryValue = string | number | undefined;

export class PoliticalCommsClient {
  readonly baseUrl: string;

  /**
   * Rate limit state from the most recent response, parsed from the
   * X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers.
   * Null until the first response is received.
   */
  lastRateLimit: RateLimitState | null = null;

  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PoliticalCommsClientOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env?.POLITICAL_COMMS_API_KEY : undefined);
    if (!apiKey) {
      throw new Error(
        'Missing Political Comms API key. Pass { apiKey } to PoliticalCommsClient or set the ' +
          'POLITICAL_COMMS_API_KEY environment variable. Keys are created in the dashboard ' +
          'under Admin > API.',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // -------------------------------------------------------------------------
  // Organizations and hierarchy
  // -------------------------------------------------------------------------

  /** GET /organizations */
  listOrganizations(options?: RequestOptions): Promise<ApiResponse<Organization[]>> {
    return this.request('GET', '/organizations', undefined, undefined, options);
  }

  /** GET /hierarchy */
  getHierarchy(
    query: GetHierarchyQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<HierarchyNode>> {
    return this.request('GET', '/hierarchy', { organizationId: query.organizationId }, undefined, options);
  }

  // -------------------------------------------------------------------------
  // Brands, campaigns, tracking domains, phone numbers
  // -------------------------------------------------------------------------

  /** GET /brands */
  listBrands(query: ListBrandsQuery = {}, options?: RequestOptions): Promise<ApiResponse<Brand[]>> {
    return this.request('GET', '/brands', { organization_id: query.organization_id }, undefined, options);
  }

  /** GET /campaigns */
  listCampaigns(
    query: ListCampaignsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<Campaign[]>> {
    return this.request(
      'GET',
      '/campaigns',
      { organization_id: query.organization_id, brand_id: query.brand_id },
      undefined,
      options,
    );
  }

  /** GET /tracking-domains */
  listTrackingDomains(
    query: ListTrackingDomainsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<TrackingDomain[]>> {
    return this.request(
      'GET',
      '/tracking-domains',
      { organization_id: query.organization_id },
      undefined,
      options,
    );
  }

  /** GET /phone-numbers */
  listPhoneNumbers(
    query: ListPhoneNumbersQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<PhoneNumber[]>> {
    return this.request(
      'GET',
      '/phone-numbers',
      {
        organization_id: query.organization_id,
        brand_id: query.brand_id,
        campaign_id: query.campaign_id,
        channel: query.channel,
        owner_type: query.owner_type,
      },
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Toll-free verifications
  // -------------------------------------------------------------------------

  /** GET /toll-free-verifications */
  listTollFreeVerifications(
    query: ListTollFreeVerificationsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<TollFreeVerification[]>> {
    return this.request(
      'GET',
      '/toll-free-verifications',
      { organization_id: query.organization_id, status: query.status },
      undefined,
      options,
    );
  }

  /** GET /toll-free-verifications/{id} */
  getTollFreeVerification(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<TollFreeVerificationDetail>> {
    return this.request(
      'GET',
      `/toll-free-verifications/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Contact lists
  // -------------------------------------------------------------------------

  /** GET /contact-lists */
  listContactLists(
    query: ListContactListsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactList[]>> {
    return this.request(
      'GET',
      '/contact-lists',
      { organization_id: query.organization_id, brand_id: query.brand_id },
      undefined,
      options,
    );
  }

  /** GET /contact-lists/{id} */
  getContactList(id: string, options?: RequestOptions): Promise<ApiResponse<ContactListDetail>> {
    return this.request('GET', `/contact-lists/${encodeURIComponent(id)}`, undefined, undefined, options);
  }

  /** POST /contact-lists/import */
  importContactList(
    body: ImportContactListRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactListImportResult>> {
    return this.request('POST', '/contact-lists/import', undefined, body, options);
  }

  /** POST /contact-lists/{id}/analyze */
  analyzeContactList(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactListAnalysisResult>> {
    return this.request(
      'POST',
      `/contact-lists/${encodeURIComponent(id)}/analyze`,
      undefined,
      undefined,
      options,
    );
  }

  /** DELETE /contact-lists/{id} */
  deleteContactList(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<DeleteContactListResult>> {
    return this.request(
      'DELETE',
      `/contact-lists/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  /** GET /media */
  listMedia(query: ListMediaQuery = {}, options?: RequestOptions): Promise<ApiResponse<MediaFile[]>> {
    return this.request(
      'GET',
      '/media',
      { organization_id: query.organization_id, brand_id: query.brand_id },
      undefined,
      options,
    );
  }

  /** POST /media */
  importMedia(
    body: ImportMediaRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<MediaImportResult>> {
    return this.request('POST', '/media', undefined, body, options);
  }

  /** GET /media/{id} */
  getMedia(id: string, options?: RequestOptions): Promise<ApiResponse<MediaFileDetail>> {
    return this.request('GET', `/media/${encodeURIComponent(id)}`, undefined, undefined, options);
  }

  /** DELETE /media/{id} */
  deleteMedia(id: string, options?: RequestOptions): Promise<ApiResponse<DeleteMediaResult>> {
    return this.request('DELETE', `/media/${encodeURIComponent(id)}`, undefined, undefined, options);
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  /** GET /projects */
  listProjects(query: ListProjectsQuery = {}, options?: RequestOptions): Promise<ApiResponse<Project[]>> {
    return this.request(
      'GET',
      '/projects',
      {
        organization_id: query.organization_id,
        brand_id: query.brand_id,
        campaign_id: query.campaign_id,
        type: query.type,
        archived: query.archived !== undefined ? String(query.archived) : undefined,
      },
      undefined,
      options,
    );
  }

  /** POST /projects */
  createProject(
    body: CreateProjectRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<CreateProjectResult>> {
    return this.request('POST', '/projects', undefined, body, options);
  }

  /** GET /projects/stats */
  getAllProjectStats(
    query: GetAllProjectStatsQuery,
    options?: RequestOptions,
  ): Promise<ApiResponse<AllProjectStats>> {
    return this.request(
      'GET',
      '/projects/stats',
      {
        startDate: query.startDate,
        endDate: query.endDate,
        organizationId: query.organizationId,
        brandId: query.brandId,
        campaignId: query.campaignId,
        status: query.status,
        limit: query.limit !== undefined ? String(query.limit) : undefined,
        offset: query.offset !== undefined ? String(query.offset) : undefined,
      },
      undefined,
      options,
    );
  }

  /** GET /projects/{id} */
  getProject(id: string, options?: RequestOptions): Promise<ApiResponse<ProjectDetail>> {
    return this.request('GET', `/projects/${encodeURIComponent(id)}`, undefined, undefined, options);
  }

  /** PATCH /projects/{id} */
  updateProject(
    id: string,
    body: UpdateProjectRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<UpdateProjectResult>> {
    return this.request('PATCH', `/projects/${encodeURIComponent(id)}`, undefined, body, options);
  }

  /** GET /projects/{id}/stats */
  getProjectStats(id: string, options?: RequestOptions): Promise<ApiResponse<ProjectStats>> {
    return this.request(
      'GET',
      `/projects/${encodeURIComponent(id)}/stats`,
      undefined,
      undefined,
      options,
    );
  }

  /** POST /projects/{id}/test */
  testProject(
    id: string,
    body: TestProjectRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<TestProjectResult>> {
    return this.request('POST', `/projects/${encodeURIComponent(id)}/test`, undefined, body, options);
  }

  /** POST /projects/{id}/schedule */
  scheduleProject(
    id: string,
    body: ScheduleProjectRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<ScheduleProjectResult>> {
    return this.request('POST', `/projects/${encodeURIComponent(id)}/schedule`, undefined, body, options);
  }

  /** POST /projects/{id}/unschedule */
  unscheduleProject(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<UnscheduleProjectResult>> {
    return this.request(
      'POST',
      `/projects/${encodeURIComponent(id)}/unschedule`,
      undefined,
      undefined,
      options,
    );
  }

  /** POST /projects/{id}/copy */
  copyProject(id: string, options?: RequestOptions): Promise<ApiResponse<CopyProjectResult>> {
    return this.request(
      'POST',
      `/projects/${encodeURIComponent(id)}/copy`,
      undefined,
      undefined,
      options,
    );
  }

  /** POST /projects/{id}/archive */
  archiveProject(id: string, options?: RequestOptions): Promise<ApiResponse<ArchiveProjectResult>> {
    return this.request(
      'POST',
      `/projects/${encodeURIComponent(id)}/archive`,
      undefined,
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Analytics and billing
  // -------------------------------------------------------------------------

  /** GET /messages/stats */
  getMessageStats(
    query: GetMessageStatsQuery,
    options?: RequestOptions,
  ): Promise<ApiResponse<MessageStats>> {
    return this.request(
      'GET',
      '/messages/stats',
      {
        startDate: query.startDate,
        endDate: query.endDate,
        organizationId: query.organizationId,
        brandId: query.brandId,
        campaignId: query.campaignId,
      },
      undefined,
      options,
    );
  }

  /** GET /ledger/usage */
  getLedgerUsage(
    query: GetLedgerUsageQuery,
    options?: RequestOptions,
  ): Promise<ApiResponse<LedgerUsage>> {
    return this.request(
      'GET',
      '/ledger/usage',
      {
        startDate: query.startDate,
        endDate: query.endDate,
        organizationId: query.organizationId,
        brandId: query.brandId,
        campaignId: query.campaignId,
      },
      undefined,
      options,
    );
  }

  /** GET /ledger/usage/by-initiator */
  getLedgerUsageByInitiator(
    query: GetLedgerUsageByInitiatorQuery,
    options?: RequestOptions,
  ): Promise<ApiResponse<LedgerUsageByInitiator>> {
    return this.request(
      'GET',
      '/ledger/usage/by-initiator',
      {
        startDate: query.startDate,
        endDate: query.endDate,
        organizationId: query.organizationId,
      },
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Email (early access)
  //
  // Every method below returns 403 EMAIL_EARLY_ACCESS until the email product
  // reaches general availability. Lists are keyset paginated: page until
  // `next_cursor` is null, and never parse a cursor.
  // -------------------------------------------------------------------------

  /** GET /email/domains. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailDomains(
    query: ListEmailDomainsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailDomain>>> {
    return this.request(
      'GET',
      '/email/domains',
      { limit: query.limit, cursor: query.cursor, search: query.search },
      undefined,
      options,
    );
  }

  /** GET /email/domains/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  getEmailDomain(id: string, options?: RequestOptions): Promise<ApiResponse<EmailDomain>> {
    return this.request(
      'GET',
      `/email/domains/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  /** GET /email/senders. Not paginated. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailSenders(
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailSenderIdentity>>> {
    return this.request('GET', '/email/senders', undefined, undefined, options);
  }

  /** GET /email/senders/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  getEmailSender(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailSenderIdentity>> {
    return this.request(
      'GET',
      `/email/senders/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  /** GET /email/lists. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailLists(
    query: ListEmailListsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailList>>> {
    return this.request(
      'GET',
      '/email/lists',
      {
        limit: query.limit,
        cursor: query.cursor,
        source_type: query.source_type,
        search: query.search,
      },
      undefined,
      options,
    );
  }

  /** GET /email/lists/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  getEmailList(id: string, options?: RequestOptions): Promise<ApiResponse<EmailList>> {
    return this.request(
      'GET',
      `/email/lists/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  /**
   * POST /email/lists. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   * `consent_attestation` records how these people agreed to hear from you.
   */
  createEmailList(
    body: CreateEmailListRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailList>> {
    return this.request('POST', '/email/lists', undefined, body, options);
  }

  /** GET /email/lists/{id}/contacts. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailListContacts(
    id: string,
    query: ListEmailContactsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailListContact>>> {
    return this.request(
      'GET',
      `/email/lists/${encodeURIComponent(id)}/contacts`,
      {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        search: query.search,
      },
      undefined,
      options,
    );
  }

  /**
   * POST /email/lists/{id}/contacts. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   *
   * Upserts up to 1000 contacts. Invalid rows do not fail the call: read
   * `results` and resend only the rows that came back 'rejected'.
   */
  addEmailListContacts(
    id: string,
    contacts: EmailContactInput[],
    options?: RequestOptions,
  ): Promise<ApiResponse<BulkUpsertResult>> {
    return this.request(
      'POST',
      `/email/lists/${encodeURIComponent(id)}/contacts`,
      undefined,
      { contacts },
      options,
    );
  }

  /** GET /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailSuppressions(
    query: ListEmailSuppressionsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailSuppression>>> {
    return this.request(
      'GET',
      '/email/suppressions',
      { limit: query.limit, cursor: query.cursor, scope: query.scope },
      undefined,
      options,
    );
  }

  /**
   * POST /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   * Up to 5000 addresses. Malformed ones come back in `invalid`, not as an error.
   */
  addEmailSuppressions(
    body: AddEmailSuppressionsRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<AddEmailSuppressionsResult>> {
    return this.request('POST', '/email/suppressions', undefined, body, options);
  }

  /**
   * DELETE /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   * Removing an address that was not suppressed is not an error.
   */
  removeEmailSuppressions(
    body: RemoveEmailSuppressionsRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<RemoveEmailSuppressionsResult>> {
    return this.request('DELETE', '/email/suppressions', undefined, body, options);
  }

  /** GET /email/campaigns. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailCampaigns(
    query: ListEmailCampaignsQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailCampaign>>> {
    return this.request(
      'GET',
      '/email/campaigns',
      {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        search: query.search,
      },
      undefined,
      options,
    );
  }

  /**
   * GET /email/campaigns/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   * Additionally returns `blocked`: why this campaign will not schedule yet.
   */
  getEmailCampaign(id: string, options?: RequestOptions): Promise<ApiResponse<EmailCampaign>> {
    return this.request(
      'GET',
      `/email/campaigns/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  /** POST /email/campaigns. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  createEmailCampaign(
    body: CreateEmailCampaignRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailCampaign>> {
    return this.request('POST', '/email/campaigns', undefined, body, options);
  }

  /**
   * POST /email/campaigns/{id}/schedule. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   * Omit `scheduled_at` to send now. If this refuses, read `blocked` on the campaign.
   */
  scheduleEmailCampaign(
    id: string,
    body: ScheduleEmailCampaignRequest = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailCampaign>> {
    return this.request(
      'POST',
      `/email/campaigns/${encodeURIComponent(id)}/schedule`,
      undefined,
      body,
      options,
    );
  }

  /** POST /email/campaigns/{id}/unschedule. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  unscheduleEmailCampaign(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailCampaign>> {
    return this.request(
      'POST',
      `/email/campaigns/${encodeURIComponent(id)}/unschedule`,
      undefined,
      undefined,
      options,
    );
  }

  /** GET /email/campaigns/{id}/stats. Cached 60s. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  getEmailCampaignStats(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailCampaignStats>> {
    return this.request(
      'GET',
      `/email/campaigns/${encodeURIComponent(id)}/stats`,
      undefined,
      undefined,
      options,
    );
  }

  /** GET /email/templates. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  listEmailTemplates(
    query: ListEmailTemplatesQuery = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<CursorPage<EmailTemplate>>> {
    return this.request(
      'GET',
      '/email/templates',
      { limit: query.limit, cursor: query.cursor, search: query.search },
      undefined,
      options,
    );
  }

  /** GET /email/templates/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA. */
  getEmailTemplate(id: string, options?: RequestOptions): Promise<ApiResponse<EmailTemplate>> {
    return this.request(
      'GET',
      `/email/templates/${encodeURIComponent(id)}`,
      undefined,
      undefined,
      options,
    );
  }

  /**
   * POST /email/templates. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   *
   * The response carries `lint` alongside the saved template. The save
   * succeeds either way, but a campaign will not schedule while `lint.errors`
   * is non-empty, so read it here rather than at send time.
   */
  createEmailTemplate(
    body: CreateEmailTemplateRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailTemplateWithLint>> {
    return this.request('POST', '/email/templates', undefined, body, options);
  }

  /**
   * POST /email/lists/import. Early access: 403 EMAIL_EARLY_ACCESS until GA.
   *
   * Fetches your CSV over https (50 MB cap, SSRF-guarded) and commits it in
   * one call. Omit `mapping` to let the server recognize a common ESP export;
   * when neither your mapping nor the recognizer finds an email column the
   * call is a 400 VALIDATION_ERROR whose `details.headers` lists the headers
   * that were read, so retry with a mapping instead of guessing. Returns 202;
   * the import's progress is shown on the list in the dashboard.
   */
  startEmailListImport(
    body: StartEmailListImportRequest,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailListImport>> {
    return this.request('POST', '/email/lists/import', undefined, body, options);
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST' || method === 'PATCH') {
      // Generated once so retries replay the same key and the API can
      // deduplicate the write.
      headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID();
    } else if (method === 'DELETE' && options.idempotencyKey !== undefined) {
      // DELETEs accept an optional Idempotency-Key but never auto-generate one.
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: options.signal,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new PoliticalCommsError(`Network request failed: ${message}`, 'NETWORK_ERROR', 0, undefined);
      }

      this.captureRateLimit(response);

      if (response.ok) {
        return (await response.json()) as ApiResponse<T>;
      }

      const rawBody = await response.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = undefined;
      }

      if (attempt < this.maxRetries) {
        if (response.status === 429) {
          await sleep(this.rateLimitDelayMs(response, attempt));
          continue;
        }
        if (RETRYABLE_STATUS.has(response.status)) {
          await sleep(backoffDelayMs(attempt));
          continue;
        }
      }

      const errorBody = parsedBody as { error?: unknown; code?: unknown } | undefined;
      const message =
        typeof errorBody?.error === 'string' && errorBody.error.length > 0
          ? errorBody.error
          : `Request failed with status ${response.status}`;
      const code =
        typeof errorBody?.code === 'string' && errorBody.code.length > 0
          ? errorBody.code
          : `HTTP_${response.status}`;
      throw new PoliticalCommsError(message, code, response.status, parsedBody ?? rawBody);
    }
  }

  private captureRateLimit(response: Response): void {
    const limit = Number(response.headers.get('X-RateLimit-Limit'));
    const remaining = Number(response.headers.get('X-RateLimit-Remaining'));
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    if (response.headers.get('X-RateLimit-Limit') !== null && Number.isFinite(limit)) {
      this.lastRateLimit = { limit, remaining, reset };
    }
  }

  /** For 429s, wait until the X-RateLimit-Reset timestamp; fall back to backoff. */
  private rateLimitDelayMs(response: Response, attempt: number): number {
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(reset) && reset > 0) {
      const waitMs = reset * 1_000 - Date.now();
      if (waitMs > 0) return waitMs;
      return BACKOFF_BASE_MS;
    }
    return backoffDelayMs(attempt);
  }
}

function backoffDelayMs(attempt: number): number {
  const capped = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  // Full-ish jitter: 50 to 100 percent of the capped delay.
  return capped * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
