/**
 * Types matching the Political Comms OpenAPI 3.1 specification v1.1.0
 * (https://politicalcomms.com/openapi.json), which is reconciled against the
 * live production API. Response object schemas in the spec allow additional
 * properties, so every entity carries an index signature; fields not
 * documented in the spec are typed as unknown.
 */

/** Standard success envelope. Every 2xx response is `{ success, data }`. */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  [key: string]: unknown;
}

/**
 * Standard error body for 4xx/5xx responses produced by the API error
 * handler. 401s and permission 403s from the authentication layer instead
 * return `{ error, message }` with no code, and 429s return a
 * rate-limit-specific body with a `retryAfter` field.
 */
export interface ErrorResponse {
  error: string;
  code: string;
  correlationId?: string;
  /**
   * An array of field-level issues for VALIDATION_ERROR; an object for other
   * codes (e.g. insufficient-balance shortfall).
   */
  details?: unknown;
  [key: string]: unknown;
}

/** Per-request options accepted by every client method. */
export interface RequestOptions {
  /**
   * Idempotency-Key header value for POST, PATCH, and DELETE requests. For
   * POST and PATCH the client generates a UUID automatically when omitted;
   * for DELETE the header is sent only when a key is supplied. The API
   * returns the cached first response when the same key is replayed.
   */
  idempotencyKey?: string;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/** Rate limit state parsed from the most recent response headers. */
export interface RateLimitState {
  /** X-RateLimit-Limit: requests allowed per hour. */
  limit: number;
  /** X-RateLimit-Remaining: requests left in the current window. */
  remaining: number;
  /** X-RateLimit-Reset: Unix timestamp (seconds) when the window resets. */
  reset: number;
}

// ---------------------------------------------------------------------------
// Organizations and hierarchy
// ---------------------------------------------------------------------------

export interface Organization {
  id?: string;
  display_name?: string;
  /** null for a root organization. */
  parent_org_name?: string | null;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface HierarchyCampaign {
  id?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HierarchyBrand {
  id?: string;
  name?: string;
  status?: string;
  organizationId?: string;
  createdAt?: string;
  updatedAt?: string;
  campaigns?: HierarchyCampaign[];
  [key: string]: unknown;
}

/** Organization node in the hierarchy tree. Note: camelCase field names. */
export interface HierarchyNode {
  id?: string;
  name?: string;
  /** null for the root organization of the returned tree. */
  parentId?: string | null;
  status?: string;
  contactEmail?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  brands?: HierarchyBrand[];
  childOrganizations?: HierarchyNode[];
  [key: string]: unknown;
}

export interface GetHierarchyQuery {
  /** Filter to a specific descendant organization. */
  organizationId?: string;
}

// ---------------------------------------------------------------------------
// Brands, campaigns, tracking domains, phone numbers
// ---------------------------------------------------------------------------

export interface Brand {
  id?: string;
  brand_name?: string;
  org_id?: string;
  org_name?: string;
  /** null until the brand is registered with TCR. */
  tcr_brand_id?: string | null;
  status?: string;
  identity_status?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface ListBrandsQuery {
  organization_id?: string;
}

export interface Campaign {
  id?: string;
  name?: string;
  brand_id?: string;
  brand_name?: string;
  org_id?: string;
  org_name?: string;
  campaign_status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ListCampaignsQuery {
  organization_id?: string;
  brand_id?: string;
}

/** Tracking domain owned by one of your accessible organizations. */
export interface OwnedTrackingDomain {
  id?: string;
  domain?: string;
  source: 'own';
  /** Always "active"; only active domains are listed. */
  status?: string;
  verified_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

/**
 * Tracking domain inherited from a parent organization that shares it with
 * sub-organizations. Only id, domain, and source are returned.
 */
export interface InheritedTrackingDomain {
  id?: string;
  domain?: string;
  source: 'inherited';
  [key: string]: unknown;
}

/** Discriminate on the `source` field. */
export type TrackingDomain = OwnedTrackingDomain | InheritedTrackingDomain;

export interface ListTrackingDomainsQuery {
  organization_id?: string;
}

export type PhoneNumberChannel = '10dlc' | 'toll-free' | 'short-code' | 'rcs';
export type PhoneNumberOwnerType = 'campaign' | 'toll_free_registration' | 'unassigned';

export interface PhoneNumber {
  id?: string;
  number?: string;
  channel?: string;
  owner_type?: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  brand_id?: string | null;
  brand_name?: string | null;
  toll_free_verification_id?: string | null;
  tf_verification_status?: string | null;
  toll_free_registration_name?: string | null;
  toll_free_business_name?: string | null;
  org_id?: string;
  org_name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ListPhoneNumbersQuery {
  organization_id?: string;
  brand_id?: string;
  campaign_id?: string;
  channel?: PhoneNumberChannel;
  owner_type?: PhoneNumberOwnerType;
}

// ---------------------------------------------------------------------------
// Toll-free verifications
// ---------------------------------------------------------------------------

export type TollFreeVerificationStatus = 'draft' | 'In Progress' | 'Verified' | 'Rejected';

export interface TollFreeVerification {
  id?: string;
  name?: string;
  /** Verbatim carrier casing, e.g. "In Progress". */
  status?: string;
  verification_request_id?: string | null;
  org_id?: string;
  org_name?: string;
  business_name?: string | null;
  use_case?: string | null;
  phone_number_count?: number;
  submitted_at?: string | null;
  verified_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface TollFreeVerificationDetail extends TollFreeVerification {
  phone_number_ids?: string[];
  rejection_reason?: string | null;
  updated_at?: string;
}

export interface ListTollFreeVerificationsQuery {
  organization_id?: string;
  status?: TollFreeVerificationStatus;
}

// ---------------------------------------------------------------------------
// Contact lists
// ---------------------------------------------------------------------------

export interface ContactList {
  id?: string;
  name?: string;
  brand_id?: string | null;
  brand_name?: string | null;
  org_id?: string;
  org_name?: string;
  created_at?: string;
  [key: string]: unknown;
}

export type ContactListImportStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type ContactListAnalysisStatus = 'not_started' | 'processing' | 'complete' | 'failed';

export interface ContactListImportSection {
  status?: ContactListImportStatus;
  /** Import progress percentage (0-100). Always 100 once status is ready. */
  progress?: number;
  total_rows?: number | null;
  total_contacts?: number | null;
  clean_contacts?: number | null;
  duplicate_count?: number | null;
  bad_number_count?: number | null;
  opted_out_count?: number | null;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  [key: string]: unknown;
}

export interface ContactListAnalysisSection {
  status?: ContactListAnalysisStatus;
  analyzed_numbers?: number;
  /** Present only after at least one number has been analyzed. */
  breakdown?: {
    mobile?: number;
    landline?: number;
    voip?: number;
    invalid?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Single-list read. Note the different field names from the list endpoint:
 * list_id (not id) and organization_id (not org_id).
 */
export interface ContactListDetail {
  list_id?: string;
  name?: string;
  brand_id?: string | null;
  organization_id?: string | null;
  /** True when the list was created through POST /contact-lists/import. */
  imported_via_api?: boolean;
  created_at?: string;
  import?: ContactListImportSection;
  analysis?: ContactListAnalysisSection;
  [key: string]: unknown;
}

export interface ListContactListsQuery {
  organization_id?: string;
  brand_id?: string;
}

export interface MergeTagCustomField {
  csv_column?: string;
  merge_tag?: string;
}

export interface MergeTagMapping {
  first_name?: string;
  last_name?: string;
  address?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  custom_fields?: MergeTagCustomField[];
}

export interface ImportContactListRequest {
  /** Publicly readable or presigned URL of the CSV to import. */
  source_url: string;
  organization_id?: string;
  brand_id?: string;
  list_name: string;
  /** Name of the CSV column that holds the phone number. */
  phone_column: string;
  merge_tags?: MergeTagMapping;
}

/** 202 Accepted. Poll GET /contact-lists/{id} for progress. */
export interface ContactListImportResult {
  list_id?: string;
  name?: string;
  status?: 'processing';
  total_rows?: number | null;
  imported_via_api?: boolean;
  [key: string]: unknown;
}

/** 202 Accepted. Poll GET /contact-lists/{id} for results. */
export interface ContactListAnalysisResult {
  list_id?: string;
  analysis?: {
    status?: 'processing';
    numbers_queued?: number;
    estimated_completion_seconds?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * 200 OK for DELETE /contact-lists/{id}. A list referenced by any project
 * cannot be deleted; the API returns 409 CONTACT_LIST_IN_USE with
 * `details.projects` listing the referencing projects ({ id, name, status }).
 */
export interface DeleteContactListResult {
  list_id?: string;
  name?: string;
  deleted?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Media list item. Field names differ from the detail read: id (not media_id)
 * and org_id (not organization_id). */
export interface MediaFile {
  id?: string;
  name?: string;
  brand_id?: string | null;
  brand_name?: string | null;
  org_id?: string;
  org_name?: string;
  created_at?: string;
  /**
   * Permanent URL of the stored file. Populated only when `status` is `ready`,
   * and null while the file is still optimizing or after a failure. Stable for
   * the life of the file: a stored file is never re-processed or rewritten, so
   * this URL always returns the same bytes. Treat it as opaque - the filename
   * can differ from `name` (video is converted to .mp4).
   */
  url?: string | null;
  storage_key?: string | null;
  /** Size of the stored file. On rows that are not yet `ready`, this is the
   * size as submitted rather than the stored size. */
  file_size_bytes?: number;
  /** Inferred from the file extension; null when unknown. */
  content_type?: string | null;
  status?: MediaStatus;
  uploaded_via_api?: boolean;
  [key: string]: unknown;
}

export type MediaStatus = 'optimizing' | 'ready' | 'failed';

/**
 * Single-media read. Note the different field names from the list endpoint:
 * media_id (not id) and organization_id (not org_id).
 */
export interface MediaFileDetail {
  media_id?: string;
  organization_id?: string | null;
  brand_id?: string | null;
  name?: string;
  status?: MediaStatus;
  /** Inferred from the file extension; null when unknown. */
  content_type?: string | null;
  /** 0 until the file has been fetched and measured. */
  file_size_bytes?: number;
  storage_key?: string | null;
  /**
   * Permanent URL of the stored file. Populated only when `status` is `ready`,
   * and null while the file is still optimizing or after a failure. Stable for
   * the life of the file: a stored file is never re-processed or rewritten, so
   * this URL always returns the same bytes. Treat it as opaque - the filename
   * can differ from `name` (video is converted to .mp4).
   */
  url?: string | null;
  uploaded_via_api?: boolean;
  created_at?: string;
  optimized_at?: string | null;
  [key: string]: unknown;
}

export interface ListMediaQuery {
  organization_id?: string;
  brand_id?: string;
}

export interface ImportMediaRequest {
  /** HTTPS URL of the media file to import. The server retrieves and stores it. */
  source_url: string;
  organization_id?: string;
  brand_id?: string;
  name?: string;
}

/** 202 Accepted. Poll GET /media/{id} for readiness. */
export interface MediaImportResult {
  media_id?: string;
  status?: 'optimizing';
  uploaded_via_api?: boolean;
  file_size_bytes?: number;
  name?: string;
  [key: string]: unknown;
}

/**
 * 200 OK for DELETE /media/{id}. A file referenced by any project cannot be
 * deleted; the API returns 409 MEDIA_IN_USE with `details.projects` listing
 * the referencing projects ({ id, name, status }).
 */
export interface DeleteMediaResult {
  media_id?: string;
  name?: string;
  deleted?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectChannel = '10dlc' | 'toll-free';
export type ProjectProtocol = 'sms' | 'mms';
export type ProjectType = 'broadcast' | 'survey';
export type ProjectStatsStatusFilter = 'draft' | 'active' | 'completed' | 'archived' | 'paused' | 'all';

/** List item returned by GET /projects. */
export interface Project {
  id?: string;
  name?: string;
  type?: ProjectType;
  status?: string;
  channel?: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  brand_id?: string | null;
  brand_name?: string | null;
  toll_free_verification_id?: string | null;
  contact_list_ids?: string[];
  org_id?: string;
  org_name?: string;
  /** null for survey projects. */
  message_text?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export type SurveyQuestionType = 'intro' | 'multiple_choice' | 'open_ended' | 'outro';

export interface SurveyQuestionOption {
  value?: number;
  label?: string;
  next_sequence?: number | null;
  [key: string]: unknown;
}

export interface SurveyQuestion {
  id?: string;
  sequence?: number;
  question_type?: SurveyQuestionType;
  question_text?: string;
  message_type?: ProjectProtocol;
  media_urls?: string[];
  response_options?: SurveyQuestionOption[] | null;
  no_match_sequence?: number | null;
  is_required?: boolean;
  [key: string]: unknown;
}

/**
 * Full project object returned by GET /projects/{id} and PATCH /projects/{id}.
 * Note: project_id (not id) and organization_id (not org_id).
 */
export interface ProjectDetail {
  project_id?: string;
  organization_id?: string;
  channel?: string;
  brand_id?: string | null;
  campaign_id?: string | null;
  toll_free_verification_id?: string | null;
  phone_number_ids?: string[];
  name?: string;
  status?: string;
  type?: ProjectType;
  protocol?: string;
  /** null for survey projects. */
  message_text?: string | null;
  contact_list_ids?: string[];
  suppression_list_ids?: string[];
  /** Always an empty array in the current API version; see media_urls. */
  media_ids?: string[];
  media_urls?: string[];
  link_tracking_enabled?: boolean;
  link_tracking_destination_url?: string | null;
  link_tracking_domain_id?: string | null;
  link_tracking_param_field?: string | null;
  ai_survey_analysis_enabled?: boolean;
  total_recipients?: number;
  estimated_cost_cents?: number;
  scheduled_at?: string | null;
  scheduled_timezone?: string | null;
  created_via_api?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Survey projects only; absent on broadcast projects. */
  questions?: SurveyQuestion[];
  [key: string]: unknown;
}

export interface ListProjectsQuery {
  organization_id?: string;
  brand_id?: string;
  campaign_id?: string;
  type?: ProjectType;
  /**
   * true returns only archived projects; false excludes archived projects;
   * omitted returns everything except deleted projects.
   */
  archived?: boolean;
}

export interface CreateProjectRequest {
  organization_id: string;
  /** Messaging channel. Defaults to 10dlc. */
  channel?: ProjectChannel;
  /** Required when channel=10dlc; omit when channel=toll-free. */
  brand_id?: string;
  /** Required when channel=10dlc; omit when channel=toll-free. */
  campaign_id?: string;
  /**
   * Required when channel=toll-free; omit when channel=10dlc. Must match the
   * verification behind the chosen phone_number_ids.
   */
  toll_free_verification_id?: string;
  /**
   * Sending phone number IDs (1-49). At least one of phone_number_ids or
   * phone_number_id is required. New conversations are spread randomly
   * across the numbers; each recipient is then pinned to one number.
   */
  phone_number_ids?: string[];
  /**
   * @deprecated Use phone_number_ids. A single id is accepted and treated as
   * a one-element phone_number_ids.
   */
  phone_number_id?: string;
  name: string;
  protocol: ProjectProtocol;
  /**
   * Contact list IDs to send to. Optional: omitting it creates the project
   * in draft status, and it cannot be tested or scheduled until a list is
   * attached via PATCH /projects/{id}. An explicitly empty array is rejected.
   */
  contact_list_ids?: string[];
  suppression_list_ids?: string[];
  message_text: string;
  media_ids?: string[];
  link_tracking_enabled?: boolean;
  link_tracking_destination_url?: string;
  link_tracking_domain_id?: string;
  /**
   * Contact field appended as a redirect query param on tracking links. Use
   * "phone", a contact custom-field name, or omit for no param (default).
   */
  link_tracking_param_field?: string;
}

/** 201 Created. */
export interface CreateProjectResult {
  project_id?: string;
  name?: string;
  type?: ProjectType;
  status?: string;
  channel?: string;
  created_via_api?: boolean;
  /** Survey projects only. */
  question_count?: number;
  estimated_cost_cents?: number;
  total_recipients?: number;
  /** Broadcast reports has_message; surveys report has_questions. */
  completeness?: {
    has_list?: boolean;
    has_message?: boolean;
    has_questions?: boolean;
    has_phone_number?: boolean;
    ready_to_test?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UpdateProjectRequest {
  name?: string;
  message_text?: string;
  protocol?: ProjectProtocol;
  phone_number_ids?: string[];
  /** @deprecated Use phone_number_ids. */
  phone_number_id?: string;
  contact_list_ids?: string[];
  suppression_list_ids?: string[];
  media_ids?: string[];
  link_tracking_enabled?: boolean;
  link_tracking_destination_url?: string | null;
  link_tracking_domain_id?: string | null;
  link_tracking_param_field?: string | null;
}

/** PATCH returns the full project object, same shape as GET /projects/{id}. */
export type UpdateProjectResult = ProjectDetail;

/** GET /projects/{id}/stats response. Counters are nested under metrics. */
export interface ProjectStats {
  project_id?: string;
  status?: string;
  as_of?: string;
  metrics?: {
    sent?: number;
    delivered?: number;
    undeliverable?: number;
    clicks_total?: number;
    clicks_unique?: number;
    replies?: number;
    opt_outs?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ProjectStatsRow {
  id?: string;
  name?: string;
  status?: string;
  protocol?: string;
  type?: ProjectType;
  channel?: string;
  organization_id?: string;
  brand_id?: string | null;
  campaign_id?: string | null;
  total_recipients?: number;
  messages_sent?: number;
  messages_delivered?: number;
  messages_failed?: number;
  messages_opted_out?: number;
  replies_received?: number;
  survey_responses_count?: number;
  survey_completion_count?: number;
  /** Numeric string in dollars, e.g. "87.1926". */
  actual_cost?: string;
  total_url_clicks?: number;
  unique_url_clicks?: number;
  url_share_count?: number;
  created_at?: string;
  completed_at?: string | null;
  updated_at?: string;
  organization_name?: string;
  brand_name?: string | null;
  campaign_name?: string | null;
  [key: string]: unknown;
}

export interface AllProjectStats {
  projects?: ProjectStatsRow[];
  summary?: {
    totalProjects?: number;
    organizationCount?: number;
    brandCount?: number;
    campaignCount?: number;
    statusBreakdown?: Record<string, number>;
    messageStats?: Record<string, number>;
    dateRange?: { earliestProject?: string | null; latestProject?: string | null };
    [key: string]: unknown;
  };
  pagination?: {
    limit?: number;
    offset?: number;
    totalCount?: number;
    hasMore?: boolean;
    [key: string]: unknown;
  };
  dateRange?: { startDate?: string; endDate?: string };
  [key: string]: unknown;
}

export interface GetAllProjectStatsQuery {
  /** Start date in YYYY-MM-DD format. Max 31-day range, no older than 90 days. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
  brandId?: string;
  campaignId?: string;
  status?: ProjectStatsStatusFilter;
  /** Number of projects to return (1-1000, default 100). */
  limit?: number;
  /** Number of projects to skip (default 0). */
  offset?: number;
}

export interface TestContact {
  /** US/Canada number in E.164 format, e.g. +15555550100. */
  phone: string;
}

export interface TestProjectRequest {
  /** 1 to 50 test recipients. */
  test_contacts: TestContact[];
}

/** 202 Accepted. */
export interface TestProjectResult {
  project_id?: string;
  status?: string;
  test_messages?: Array<{
    test_message_id?: string;
    /** Masked recipient number, e.g. +1555****100. */
    sent_to?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface ScheduleProjectRequest {
  /**
   * ISO 8601 date-time including a timezone offset, at least 60 seconds in
   * the future.
   */
  scheduled_at: string;
  /** IANA timezone name, for example "America/New_York". */
  scheduled_timezone: string;
}

export interface ScheduleProjectResult {
  project_id?: string;
  status?: string;
  scheduled_at?: string;
  scheduled_timezone?: string;
  [key: string]: unknown;
}

export interface UnscheduleProjectResult {
  project_id?: string;
  status?: string;
  unscheduled_at?: string;
  [key: string]: unknown;
}

/**
 * 201 Created for POST /projects/{id}/copy. The copy drops contact lists,
 * schedule, and stats, starts in draft status, and gets a versioned name
 * (X becomes X_v2).
 */
export interface CopyProjectResult {
  project_id?: string;
  name?: string;
  type?: ProjectType;
  status?: string;
  channel?: string;
  created_via_api?: boolean;
  estimated_cost_cents?: number;
  total_recipients?: number;
  completeness?: {
    has_list?: boolean;
    has_message?: boolean;
    has_phone_number?: boolean;
    ready_to_test?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * 200 OK for POST /projects/{id}/archive. Only projects in completed status
 * can be archived; otherwise the API returns 409 INVALID_STATE_TRANSITION.
 */
export interface ArchiveProjectResult {
  project_id?: string;
  status?: string;
  archived_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Analytics and billing
// ---------------------------------------------------------------------------

/** Per-status message bucket in MessageStats.totals. */
export interface MessageStatusBucket {
  count?: number;
  totalCost?: number;
  [key: string]: unknown;
}

export interface MessageStats {
  /**
   * Keyed by delivery status (unsent, queued, sending, sent, delivered,
   * failed, received, on_hold). Only statuses present in the range appear.
   */
  totals?: Record<string, MessageStatusBucket>;
  summary?: {
    totalMessages?: number;
    statusBreakdown?: Record<string, number>;
    totalCost?: number;
    projectCount?: number;
    organizationCount?: number;
    [key: string]: unknown;
  };
  deliveryRates?: {
    totalMessages?: number;
    deliveredCount?: number;
    failedCount?: number;
    successfulCount?: number;
    /** Percentage 0-100. */
    deliveryRate?: number;
    failureRate?: number;
    successRate?: number;
    [key: string]: unknown;
  };
  /** One row per date + status combination, newest date first. */
  byDay?: Array<{
    date?: string;
    status?: string;
    count?: number;
    totalCost?: number;
    [key: string]: unknown;
  }>;
  dateRange?: { startDate?: string; endDate?: string };
  [key: string]: unknown;
}

export interface GetMessageStatsQuery {
  /** Start date in YYYY-MM-DD format. Max 31-day range, no older than 180 days. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
  brandId?: string;
  campaignId?: string;
}

export interface LedgerUsageLine {
  productCode?: string;
  eventType?: string;
  quantity?: number;
  /** Positive unit rate; direction lives on totalAmount. */
  unitPrice?: number;
  /** Signed amount in dollars; charges are negative. */
  totalAmount?: number;
  transactionCount?: number;
  [key: string]: unknown;
}

export interface LedgerOrganizationUsage {
  organizationId?: string;
  organizationName?: string;
  stripeCustomerId?: string | null;
  accountRep?: string | null;
  tier?: number | null;
  usage?: LedgerUsageLine[];
  /** Always empty on this endpoint. */
  payments?: unknown[];
  /** Always empty on this endpoint. */
  adjustments?: unknown[];
  totalUsageAmount?: number;
  /** Always 0 on this endpoint. */
  totalPaymentAmount?: number;
  [key: string]: unknown;
}

/** GET /ledger/usage response. Note: camelCase field names. */
export interface LedgerUsage {
  startDate?: string;
  endDate?: string;
  organizations?: LedgerOrganizationUsage[];
  totalUsageAmount?: number;
  totalPaymentAmount?: number;
  totalQuantity?: number;
  /** Total quantity per product code across all organizations. */
  serviceTotals?: Record<string, number>;
  [key: string]: unknown;
}

export interface LedgerInitiatorUsage {
  initiatingOrganizationId?: string;
  initiatingOrganizationName?: string | null;
  usage?: Array<LedgerUsageLine & { date?: string }>;
  totalAmount?: number;
  totalQuantity?: number;
  transactionCount?: number;
  [key: string]: unknown;
}

/** GET /ledger/usage/by-initiator response. Note: camelCase field names. */
export interface LedgerUsageByInitiator {
  startDate?: string;
  endDate?: string;
  /** Sorted by totalAmount descending. */
  initiators?: LedgerInitiatorUsage[];
  totalAmount?: number;
  totalQuantity?: number;
  totalTransactionCount?: number;
  [key: string]: unknown;
}

export interface GetLedgerUsageQuery {
  /** Start date in YYYY-MM-DD format. Max 31-day range, no older than 180 days. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
  brandId?: string;
  campaignId?: string;
}

export interface GetLedgerUsageByInitiatorQuery {
  /** Start date in YYYY-MM-DD format. Max 31-day range, no older than 180 days. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
}
