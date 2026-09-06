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

/**
 * What the imported file is for. MMS attachments are brand-scoped; email
 * assets are organization-scoped, so `brand_id` must be omitted when usage is
 * 'email_asset'. Sending both is refused at the schema layer with a 400
 * VALIDATION_ERROR rather than the brand being ignored.
 */
export type MediaUsage = 'mms' | 'email_asset';

export interface ImportMediaRequest {
  /** HTTPS URL of the media file to import. The server retrieves and stores it. */
  source_url: string;
  organization_id?: string;
  brand_id?: string;
  name?: string;
  /** Defaults to 'mms'. Use 'email_asset' for images an email template references. */
  usage?: MediaUsage;
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
export type ProjectStatsStatusFilter = 'draft' | 'active' | 'completed' | 'paused' | 'all';

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
  /**
   * Set only when link_tracking_destination_url is a whole-URL placeholder
   * ("https://{custom_url}"): where recipients whose field was empty or not
   * a valid URL were sent.
   */
  link_tracking_fallback_url?: string | null;
  /**
   * Whether the "STOP=END" opt-out footer is appended to outbound messages.
   * Broadcast only; surveys never carry the footer.
   */
  opt_out_footer_enabled?: boolean;
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
  /**
   * Where tracking links redirect. May embed the selected link parameter
   * anywhere via a placeholder named after it, e.g.
   * "https://test.com?utm_content=xyzd_{linkid}" redirects as
   * "...utm_content=xyzd_ABC123" (URL-encoded value; the parameter is then
   * not appended separately). A placeholder that does not match
   * link_tracking_param_field is rejected with a 400
   * (INVALID_LINK_PLACEHOLDER). Without a placeholder the parameter is
   * appended as its own query pair.
   *
   * May also be exactly "https://{<link_tracking_param_field>}", e.g.
   * "https://{custom_url}": each recipient's tracking link then redirects to
   * the URL stored in that contact field. In that mode
   * link_tracking_fallback_url is required, and "{phone}" is not allowed as
   * a whole URL.
   */
  link_tracking_destination_url?: string;
  link_tracking_domain_id?: string;
  /**
   * Contact field carried on tracking-link redirects. Use "phone", a contact
   * custom-field name, or omit for no param (default). Appended as a query
   * pair, or embedded in place of a matching {field} placeholder in the
   * destination URL.
   */
  link_tracking_param_field?: string;
  /**
   * Redirect used when a recipient's link_tracking_param_field value is empty
   * or not a valid URL. Required when link_tracking_destination_url is a
   * whole-URL placeholder; rejected with a 400 (INVALID_LINK_PLACEHOLDER)
   * otherwise.
   */
  link_tracking_fallback_url?: string;
  /**
   * Whether the "STOP=END" opt-out footer is appended to every outbound
   * message. Defaults to true.
   */
  opt_out_footer_enabled?: boolean;
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
  /** Supports the {field} placeholder; see CreateProjectRequest. */
  link_tracking_destination_url?: string | null;
  link_tracking_domain_id?: string | null;
  /** "phone", a custom-field name, or null for none. */
  link_tracking_param_field?: string | null;
  /**
   * Required when link_tracking_destination_url is a whole-URL placeholder
   * ("https://{custom_url}"); see CreateProjectRequest.
   */
  link_tracking_fallback_url?: string | null;
  /** Whether the "STOP=END" opt-out footer is appended to outbound messages. */
  opt_out_footer_enabled?: boolean;
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
  /**
   * Test-send activity, tracked separately - `metrics` excludes it. Unlike
   * the cumulative production counters, these form a pipeline: `sent` holds
   * only tests still awaiting a delivery outcome and moves into `delivered`
   * or `failed` once the carrier reports back.
   */
  test?: {
    sent?: number;
    delivered?: number;
    failed?: number;
    replies?: number;
    clicks_total?: number;
    clicks_unique?: number;
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

/** The six US IANA zones the schedule endpoint accepts; any other value is rejected with a 400. */
export type ScheduleTimezone =
  | 'America/New_York'
  | 'America/Chicago'
  | 'America/Denver'
  | 'America/Los_Angeles'
  | 'America/Anchorage'
  | 'Pacific/Honolulu';

export interface ScheduleProjectRequest {
  /**
   * ISO 8601 date-time including a timezone offset. May be now or in the
   * past - the project starts sending as soon as audience compilation
   * finishes (no minimum lead time).
   */
  scheduled_at: string;
  /** One of the six supported US IANA zones, for example "America/New_York". */
  scheduled_timezone: ScheduleTimezone;
  /**
   * Run the whole project past the brand's T-Mobile daily cap instead of
   * pausing at it.
   *
   * Only meaningful for brands T-Mobile meters (Aegis-vetted, non-political):
   * those carry a per-brand daily cap, and a project otherwise pauses at it
   * each Pacific day and must be started again to continue. Ignored for
   * brands with no cap.
   *
   * Setting this accepts that messages to T-Mobile recipients over the limit
   * may fail and are still billed - carrier is not reliably known before
   * sending, so the platform cannot skip only those recipients. Defaults to
   * false (pause), and persists for the life of the project.
   */
  daily_cap_bypass?: boolean;
}

export interface ScheduleProjectResult {
  project_id?: string;
  status?: string;
  scheduled_at?: string;
  scheduled_timezone?: string;
  /** The persisted bypass setting, so you can confirm what took effect. */
  daily_cap_bypass?: boolean;
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

// ---------------------------------------------------------------------------
// Email (early access)
//
// Every /v1/email endpoint returns 403 EMAIL_EARLY_ACCESS until the email
// product reaches general availability. The contract below is stable.
// ---------------------------------------------------------------------------

/** Keyset-paginated list envelope used by every email list endpoint. */
export interface CursorPage<T> {
  data: T[];
  has_more: boolean;
  /** Opaque; pass back as `cursor`. Null on the last page. Never parse it. */
  next_cursor: string | null;
}

export interface EmailPageQuery {
  /** Rows per page, 1-200. Defaults to 50. */
  limit?: number;
  /** Cursor from the previous page's `next_cursor`. */
  cursor?: string;
}

export interface EmailDnsRecord {
  type: 'CNAME' | 'TXT' | 'MX';
  name: string;
  value: string | null;
  purpose?: string | null;
  [key: string]: unknown;
}

export interface EmailDomain {
  id: string;
  domain: string;
  status: 'pending' | 'active' | 'failed';
  dns_records?: EmailDnsRecord[];
  verification?: Record<string, string | null>;
  error_message?: string | null;
  last_checked_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ListEmailDomainsQuery extends EmailPageQuery {
  search?: string;
}

/** Status of this address in Google's Gmail Verified Sender Program, submitted through Campaign Verify. Read-only. */
export interface GmailVerifiedSender {
  status:
    | 'not_eligible'
    | 'eligible'
    | 'ready_to_submit'
    | 'submitted'
    | 'verified'
    | 'suspended'
    | 'rejected'
    | 'expired';
  submitted_at: string | null;
  /** Set when status is verified, else null. */
  verified_at: string | null;
}

export interface EmailSenderIdentity {
  id: string;
  email_domain_id: string;
  from_address: string;
  from_local_part?: string;
  from_name?: string;
  reply_to?: string | null;
  status: 'draft' | 'active' | 'paused';
  physical_address?: string | null;
  disclaimer?: string | null;
  disclaimer_required?: boolean;
  authorized_by_candidate?: boolean;
  gmail_verified_sender?: GmailVerifiedSender | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export type EmailListSourceType = 'uploaded' | 'segmented' | 'winred' | 'anedot';

export type EmailContactStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'bounced'
  | 'complained'
  | 'invalid'
  | 'sunset';

export interface EmailListCounts {
  total?: number;
  sendable?: number;
  bounced?: number;
  complained?: number;
  unsubscribed?: number;
  invalid?: number;
  suppressed_global?: number;
  [key: string]: unknown;
}

export interface EmailList {
  id: string;
  name: string;
  description?: string | null;
  source_type: EmailListSourceType;
  status: 'processing' | 'ready' | 'failed' | 'archived';
  /** null = organization-wide; set = only campaigns on that sending domain may use the list. */
  email_domain_id?: string | null;
  /** Provenance for a list you did not collect yourself. Acquired lists must be validated before the first send. */
  acquired?: string | null;
  sunset_enabled?: boolean;
  validated_at?: string | null;
  counts?: EmailListCounts;
  last_send_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/** How the people on a list consented to hear from you. Required on create. */
export interface EmailConsentAttestation {
  source: string;
  note?: string;
}

export interface ListEmailListsQuery extends EmailPageQuery {
  source_type?: EmailListSourceType;
  search?: string;
}

export interface CreateEmailListRequest {
  name: string;
  consent_attestation: EmailConsentAttestation;
  description?: string;
  /** Scope the list to one sending domain. Omit for an organization-wide list. */
  email_domain_id?: string;
  acquired?: string;
  sunset_enabled?: boolean;
}

export interface EmailListContact {
  id: string;
  email: string;
  status: EmailContactStatus;
  status_reason?: string | null;
  fields?: Record<string, unknown>;
  consent_source?: string | null;
  consent_at?: string | null;
  validation_state?: string | null;
  added_at?: string;
  last_engaged_at?: string | null;
  [key: string]: unknown;
}

export interface ListEmailContactsQuery extends EmailPageQuery {
  status?: EmailContactStatus;
  search?: string;
}

export interface EmailContactInput {
  email: string;
  fields?: Record<string, unknown>;
  consent_source?: string;
  /** ISO 8601 date-time. */
  consent_at?: string;
}

/** Per-row outcome. Invalid rows are reported, not fatal. */
export interface BulkUpsertResult {
  written: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  results: Array<{
    index: number;
    email: string;
    status: 'accepted' | 'rejected' | 'duplicate';
    reason: string | null;
  }>;
  [key: string]: unknown;
}

export interface RemoveEmailContactsResult {
  unsubscribed: number;
  submitted: number;
  [key: string]: unknown;
}

export type EmailSuppressionScope = 'org' | 'identity' | 'domain';

export interface EmailSuppression {
  email: string;
  scope: EmailSuppressionScope;
  reason?: string | null;
  source?: string | null;
  sender_identity_id?: string | null;
  email_domain_id?: string | null;
  suppressed_at?: string;
  [key: string]: unknown;
}

export interface ListEmailSuppressionsQuery extends EmailPageQuery {
  scope?: EmailSuppressionScope;
}

export interface AddEmailSuppressionsRequest {
  scope: EmailSuppressionScope;
  /** 1-5000 addresses. */
  emails: string[];
  reason?: string;
  /** Required when scope is 'identity'. */
  sender_identity_id?: string;
  /** Required when scope is 'domain'. */
  email_domain_id?: string;
}

export interface RemoveEmailSuppressionsRequest {
  scope: EmailSuppressionScope;
  /** 1-5000 addresses. */
  emails: string[];
  sender_identity_id?: string;
  email_domain_id?: string;
}

export interface AddEmailSuppressionsResult {
  added: number;
  submitted: number;
  invalid: string[];
  [key: string]: unknown;
}

export interface RemoveEmailSuppressionsResult {
  removed: number;
  submitted: number;
  [key: string]: unknown;
}

export type EmailCampaignStatus =
  | 'draft'
  | 'awaiting_test'
  | 'awaiting_approval'
  | 'ready'
  | 'scheduled'
  | 'compiling'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'deleted';

export interface EmailCampaignCounts {
  queued?: number;
  sent?: number;
  delivered?: number;
  bounced?: number;
  complained?: number;
  unsubscribed?: number;
  opened?: number;
  clicked?: number;
  failed?: number;
  [key: string]: unknown;
}

export type EmailCampaignApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

/**
 * `max_reach` (default) sends to every subscribed contact. `max_deliverability`
 * sends only to contacts whose current validation verdict is deliverable;
 * never-validated contacts are skipped.
 */
export type EmailCampaignRecipientPolicy = 'max_reach' | 'max_deliverability';

export interface EmailCampaign {
  id: string;
  name: string;
  status: EmailCampaignStatus;
  sender_identity_id: string;
  list_ids?: string[];
  suppression_list_ids?: string[];
  refcode?: string | null;
  source_code?: string | null;
  scheduled_at?: string | null;
  timezone?: string | null;
  audience_count?: number | null;
  counts?: EmailCampaignCounts;
  pause_reason?: string | null;
  /** Tracking domain serving this campaign's `/e/*` URLs. `null` = the platform link host. */
  tracking_domain_id?: string | null;
  /**
   * The resolved tracking domain, on the single-campaign read. Links are
   * branded only while `status` is `active`; any other status means the send
   * falls back to the platform link host.
   */
  tracking_domain?: { id: string; domain: string; status: string } | null;
  /** Returned by the single-campaign read: why this campaign will not schedule yet. */
  blocked?: Array<{ code: string; message: string }>;
  require_approval?: boolean;
  /**
   * Which subscribed contacts on the campaign's lists actually receive it.
   * `max_reach` (default) sends to every subscribed contact.
   * `max_deliverability` sends only to contacts whose current validation
   * verdict is deliverable; never-validated contacts are skipped.
   */
  recipient_policy?: EmailCampaignRecipientPolicy;
  approval_status?: EmailCampaignApprovalStatus;
  /** ISO 8601 date-time of the last accepted test send, or null. */
  last_tested_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ListEmailCampaignsQuery extends EmailPageQuery {
  status?: EmailCampaignStatus;
  search?: string;
}

export interface CreateEmailCampaignRequest {
  name: string;
  sender_identity_id: string;
  /** 1-50 list ids. */
  list_ids: string[];
  suppression_list_ids?: string[];
  template_id?: string;
  subject?: string;
  preheader?: string;
  html?: string;
  source_code?: string;
  refcode?: string;
  append_utm?: boolean;
  is_repermission?: boolean;
  /**
   * Tracking domain for this campaign's tracked links, open pixel, unsubscribe
   * page and browser view, so recipients see your own `links.` host. Must be an
   * active tracking domain your organization owns or inherits. Omit to let the
   * platform pick the obvious default (the one matching your sending domain's
   * root, or your only one); pass `null` to force the platform link host.
   */
  tracking_domain_id?: string | null;
  require_approval?: boolean;
  /**
   * Which subscribed contacts on the campaign's lists actually receive it.
   * `max_reach` (default) sends to every subscribed contact.
   * `max_deliverability` sends only to contacts whose current validation
   * verdict is deliverable; never-validated contacts are skipped.
   */
  recipient_policy?: EmailCampaignRecipientPolicy;
}

export interface TestEmailCampaignResult {
  sent: number;
  recipients: string[];
  [key: string]: unknown;
}

export interface ScheduleEmailCampaignRequest {
  /** ISO 8601 date-time. Omit to send now. */
  scheduled_at?: string;
}

export interface EmailCampaignStats {
  campaign_id: string;
  status: string;
  tiles?: Record<string, unknown>;
  links?: Array<{
    id: string;
    url: string;
    label: string | null;
    is_donation_link: boolean;
    clicks: number;
    unique_clicks: number;
  }>;
  /** Always true: test and seed sends are excluded from every figure. */
  excludes_test_and_seed?: boolean;
  [key: string]: unknown;
}

export interface DeletedResult {
  deleted?: boolean;
  [key: string]: unknown;
}

/**
 * Template body. `editor` is `'html'` for a template imported or hand-written
 * as HTML, or `'document'` for one built in the dashboard's document editor;
 * both are readable here as rendered HTML only. This surface only accepts
 * HTML content on create. Updating the `content` of a `'document'` template
 * returns `409 CONFLICT` with `details.reason` set to `'TEMPLATE_IS_DOCUMENT'`:
 * edit it in the dashboard, or convert it to an HTML template first.
 */
export interface EmailTemplateContent {
  subject: string | null;
  preheader: string | null;
  html: string | null;
  text: string | null;
  editor: 'html' | 'document';
}

export interface EmailTemplate {
  id: string;
  name: string;
  description: string | null;
  content: EmailTemplateContent;
  thumbnail_url: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Deliverability and compliance findings for the saved HTML, in the same shape
 * the dashboard renders. Typed loosely because the rule set grows without a
 * version bump; read `errors` and `warnings` and show the rest verbatim.
 */
export interface EmailTemplateLint {
  errors?: unknown[];
  warnings?: unknown[];
  [key: string]: unknown;
}

/**
 * Create and update return the saved template plus its lint findings. The save
 * succeeds regardless, but a campaign will not schedule while `lint.errors` is
 * non-empty, so check it here rather than at send time.
 */
export interface EmailTemplateWithLint extends EmailTemplate {
  lint?: EmailTemplateLint;
}

export interface ListEmailTemplatesQuery extends EmailPageQuery {
  /** Case-insensitive substring match, 1-255 characters. */
  search?: string;
}

export interface CreateEmailTemplateRequest {
  /** 1-255 characters. */
  name: string;
  content: {
    /** 1-900 characters. */
    subject: string;
    /** Up to 255 characters. */
    preheader?: string;
    /** 1 character to 2 MB. */
    html: string;
    /** Up to 500 KB. Generated from the HTML when omitted. */
    text?: string;
  };
  /** Up to 2000 characters. */
  description?: string;
}

export type EmailTemplateDraftStatus = 'queued' | 'running' | 'ready' | 'failed';

/**
 * INSUFFICIENT_BALANCE here means the wallet emptied mid-generation, which
 * leaves the draft failed and unbilled. A wallet that cannot cover the draft
 * up front is rejected at request time with a 402 instead, and no draft row
 * is created.
 */
export type EmailTemplateDraftErrorCode =
  | 'EMAIL_DRAFT_INVALID'
  | 'EMAIL_DRAFT_MODEL_ERROR'
  | 'INSUFFICIENT_BALANCE';

/** Hex triplets (#rrggbb) the generated design should use. */
/** How the people in the imported file consented to hear from you. */
export type EmailListImportConsentSource =
  | 'donation_form'
  | 'petition'
  | 'signup_form'
  | 'event'
  | 'purchased'
  | 'rented'
  | 'other';

export interface EmailListImport {
  id: string;
  status: string;
  email_list_id: string | null;
  file_name: string | null;
  file_size: number;
  /** Column headers read from the CSV. */
  headers: string[];
  /** CSV header to contact field, as applied. */
  mapping: Record<string, string>;
  /** The ESP export format the recognizer matched, or null. */
  recognized_provider: string | null;
  summary: Record<string, unknown> | null;
  error_message: string | null;
  created_at?: string;
  started_at: string | null;
  completed_at: string | null;
  [key: string]: unknown;
}

export interface StartEmailListImportRequest {
  /** HTTPS URL of the CSV. The server fetches it; there is no file upload on this surface. */
  source_url: string;
  /**
   * Name for the list this file becomes. Defaults to the file name. The
   * uploaded file IS the list: an import creates one rather than adding to an
   * existing list.
   */
  name?: string;
  /** Scope the new list to one sending domain. Omit for organization-wide. */
  email_domain_id?: string;
  /** The addresses were purchased or rented; the list must pass validation before a send. */
  acquired?: boolean;
  consent: {
    source: EmailListImportConsentSource;
    note?: string;
  };
  /**
   * CSV header to contact field. Omit to let the server recognize a common ESP
   * export; when neither your mapping nor the recognizer finds an email column
   * the call is a 400 VALIDATION_ERROR whose `details.headers` lists the
   * headers that were read, so you can retry with a mapping instead of
   * guessing.
   */
  mapping?: Record<string, string>;
  options?: {
    /** Accept role addresses (info@, sales@) instead of rejecting them. */
    allow_role?: boolean;
  };
}
