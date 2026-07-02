/**
 * Types derived from the Political Comms OpenAPI 3.1 specification
 * (https://politicalcomms.com/openapi.json). Response object schemas in the
 * spec allow additional properties, so every entity carries an index
 * signature; fields not documented in the spec are typed as unknown.
 */

/** Standard success envelope. Every 2xx response is `{ success, data }`. */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  [key: string]: unknown;
}

/** Error body returned by the API for non-2xx responses. */
export interface ErrorResponse {
  success: boolean;
  error: string;
  code: string;
  statusCode: number;
}

/** Per-request options accepted by every client method. */
export interface RequestOptions {
  /**
   * Idempotency-Key header value for POST and PATCH requests. When omitted
   * the client generates a UUID automatically. The API returns the cached
   * first response when the same key is replayed.
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
  parent_org_name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface HierarchyNode {
  id?: string;
  display_name?: string;
  brands?: Record<string, unknown>[];
  children?: Record<string, unknown>[];
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
  tcr_brand_id?: string;
  status?: string;
  identity_status?: string;
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

export interface TrackingDomain {
  id?: string;
  domain?: string;
  org_id?: string;
  org_name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

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
  status?: string;
  verification_request_id?: string;
  org_id?: string;
  org_name?: string;
  business_name?: string;
  use_case?: string;
  phone_number_count?: number;
  submitted_at?: string;
  verified_at?: string;
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
  list_name?: string;
  org_id?: string;
  brand_id?: string;
  contact_count?: number;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ContactListDetail extends ContactList {
  import_progress?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
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

export interface ContactListImportResult {
  id?: string;
  list_name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ContactListAnalysisResult {
  id?: string;
  analysis_status?: string;
  queued_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaFile {
  id?: string;
  name?: string;
  org_id?: string;
  brand_id?: string;
  content_type?: string;
  size_bytes?: number;
  status?: string;
  url?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface MediaFileDetail extends MediaFile {
  width?: number;
  height?: number;
}

export interface ListMediaQuery {
  organization_id?: string;
  brand_id?: string;
}

export interface ImportMediaRequest {
  /** Publicly readable or presigned URL of the media file to import. */
  source_url: string;
  organization_id?: string;
  brand_id?: string;
  name?: string;
}

export interface MediaImportResult {
  id?: string;
  name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectChannel = '10dlc' | 'toll-free';
export type ProjectProtocol = 'sms' | 'mms';
export type ProjectStatsStatusFilter = 'draft' | 'active' | 'completed' | 'archived' | 'all';

export interface Project {
  id?: string;
  name?: string;
  campaign_id?: string;
  campaign_name?: string;
  brand_id?: string;
  brand_name?: string;
  org_id?: string;
  org_name?: string;
  message_text?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ProjectDetail extends Project {
  status?: string;
  channel?: string;
  toll_free_verification_id?: string | null;
  phone_number_ids?: string[];
  protocol?: string;
  media_ids?: unknown[];
  contact_list_ids?: string[];
  suppression_list_ids?: unknown[];
  link_tracking_enabled?: boolean;
  link_tracking_destination_url?: string;
  link_tracking_domain_id?: string;
  link_tracking_param_field?: string;
  scheduled_at?: string;
  scheduled_timezone?: string;
}

export interface ListProjectsQuery {
  organization_id?: string;
  brand_id?: string;
  campaign_id?: string;
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
   * Sending phone number IDs (1-49). New conversations are spread randomly
   * across them; each recipient is then pinned to one number.
   */
  phone_number_ids: string[];
  /**
   * @deprecated Use phone_number_ids. A single id is accepted and treated as
   * a one-element phone_number_ids.
   */
  phone_number_id?: string;
  name: string;
  protocol: ProjectProtocol;
  contact_list_ids: string[];
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

export interface CreateProjectResult {
  id?: string;
  name?: string;
  status?: string;
  channel?: string;
  organization_id?: string;
  brand_id?: string;
  campaign_id?: string;
  toll_free_verification_id?: string | null;
  phone_number_ids?: string[];
  protocol?: string;
  message_text?: string;
  created_at?: string;
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

export interface UpdateProjectResult {
  id?: string;
  name?: string;
  status?: string;
  message_text?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ProjectStats {
  project_id?: string;
  sent?: number;
  delivered?: number;
  undeliverable?: number;
  replies?: number;
  opt_outs?: number;
  clicks?: number;
  unique_clicks?: number;
  delivery_rate?: number;
  reply_rate?: number;
  click_rate?: number;
  [key: string]: unknown;
}

export interface AllProjectStats {
  totals?: Record<string, unknown>;
  projects?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface GetAllProjectStatsQuery {
  /** Start date in YYYY-MM-DD format. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
  brandId?: string;
  campaignId?: string;
  status?: ProjectStatsStatusFilter;
}

export interface TestContact {
  phone: string;
}

export interface TestProjectRequest {
  /** 1 to 50 test recipients. */
  test_contacts: TestContact[];
}

export interface TestProjectResult {
  project_id?: string;
  tests_sent?: number;
  sent_to?: string[];
  queued_at?: string;
  [key: string]: unknown;
}

export interface ScheduleProjectRequest {
  /** ISO 8601 date-time at which to send. */
  scheduled_at: string;
  /** IANA timezone name, for example "America/New_York". */
  scheduled_timezone: string;
}

export interface ScheduleProjectResult {
  id?: string;
  status?: string;
  scheduled_at?: string;
  scheduled_timezone?: string;
  [key: string]: unknown;
}

export interface UnscheduleProjectResult {
  id?: string;
  status?: string;
  scheduled_at?: string | null;
  scheduled_timezone?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Analytics and billing
// ---------------------------------------------------------------------------

export interface MessageStats {
  totals?: Record<string, unknown>;
  daily?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface GetMessageStatsQuery {
  /** Start date in YYYY-MM-DD format. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
  brandId?: string;
  campaignId?: string;
}

export interface LedgerUsage {
  organization_id?: string;
  organization_name?: string;
  period?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  by_category?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface LedgerUsageByInitiator {
  period?: Record<string, unknown>;
  by_initiator?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface GetLedgerUsageQuery {
  /** Start date in YYYY-MM-DD format. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  organizationId?: string;
}
