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
   * codes (e.g. insufficient-balance shortfall, or, for
   * `ONBOARDING_INCOMPLETE`, `{ missingSteps: ('profile' | 'funding')[],
   * onboardingUrl: string }`). For `ENTITLEMENT_REQUIRED`,
   * `{ entitlement: string }` naming the missing entitlement key (e.g.
   * `'email'`). For `SENDING_PAUSED`,
   * `{ scope: 'organization' | 'platform' }`.
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
  /** Short internal note set in the dashboard or bulk CSV import; null when unset. */
  notes?: string | null;
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
  /** Short internal note set in the dashboard; null when unset. */
  notes?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

/**
 * GET /campaigns/{id}/throughput response. The two carrier lanes are
 * independent. `t_mobile` is null whenever the brand has no T-Mobile daily
 * limit on file (political brands have none today); `att` is null only when
 * the campaign has no AT&T rate on file. A null inside means not known right
 * now, never zero.
 */
export interface CampaignThroughput {
  campaign_id: string;
  brand_id: string;
  /** True if either lane applies. False (both lanes null) when the campaign has neither. */
  carrier_metered: boolean;
  /** Null when the brand has no T-Mobile daily limit on file; when present `daily_cap` is always an integer. The cap, `used_today` and `remaining_today` are message parts (160-character SMS segments; an MMS is one). */
  t_mobile: {
    daily_cap: number;
    /** Message parts counted against the cap today. Null when today's usage is temporarily unavailable. */
    used_today: number | null;
    /** Null when `used_today` is null. */
    remaining_today: number | null;
    /** The current Pacific day (YYYY-MM-DD); the cap resets at midnight Pacific. */
    pacific_day: string;
  } | null;
  /** Null only when the campaign has no AT&T rate on file; `sms_tpm` and `mms_tpm` can each be null. AT&T counts message parts: a two-part text counts twice. AT&T traffic is sent right away and delivered at this rate, usually within about an hour; only in the last 90 minutes of the recipients' sending window are AT&T recipients that could not be delivered before the window closes held back. */
  att: {
    /** SMS message parts per minute. */
    sms_tpm: number | null;
    /** MMS messages per minute (a picture message counts once). */
    mms_tpm: number | null;
  } | null;
}

export interface ListCampaignsQuery {
  organization_id?: string;
  brand_id?: string;
}

/** Tracking domain owned by one of your accessible organizations. */
export interface OwnedTrackingDomain {
  id?: string;
  domain?: string;
  source: "own";
  /** Always "active"; only active domains are listed. */
  status?: string;
  verified_at?: string | null;
  created_at?: string;
  /** Short internal note set on the Domains page; null when unset. Owned rows only. */
  notes?: string | null;
  [key: string]: unknown;
}

/**
 * Tracking domain inherited from a parent organization that shares it with
 * sub-organizations. Only id, domain, and source are returned.
 */
export interface InheritedTrackingDomain {
  id?: string;
  domain?: string;
  source: "inherited";
  [key: string]: unknown;
}

/** Discriminate on the `source` field. */
export type TrackingDomain = OwnedTrackingDomain | InheritedTrackingDomain;

export interface ListTrackingDomainsQuery {
  organization_id?: string;
}

export type PhoneNumberChannel = "10dlc" | "toll-free" | "short-code" | "rcs";
export type PhoneNumberOwnerType =
  "campaign" | "toll_free_registration" | "short_code" | "unassigned";

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
  /** When this organization acquired the number. A number released and purchased again is a new record with a new `id`. */
  created_at?: string;
  /** True when an ancestor organization shared this number with `org_id` under `nickname`. Owner names and `brand_id` are null on shared rows. */
  shared?: boolean;
  /** The sharing organization's nickname for the number; null on owned rows. */
  nickname?: string | null;
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

export type TollFreeVerificationStatus =
  "draft" | "In Progress" | "Verified" | "Rejected";

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

/**
 * Which channels a list reaches: `text` when it holds phone numbers, `email`
 * when it holds email addresses.
 */
export type ContactListChannel = "text" | "email";

export type ContactListEmailSourceType = "uploaded" | "segmented" | "winred" | "anedot";

export interface ContactListEmailCounts {
  total?: number;
  sendable?: number;
  bounced?: number;
  complained?: number;
  unsubscribed?: number;
  invalid?: number;
  suppressed_global?: number;
  [key: string]: unknown;
}

/** The email side of a list. `status` is the email import status: poll GET /contact-lists/{id} until it is `ready`. */
export interface ContactListEmail {
  description?: string | null;
  source_type?: ContactListEmailSourceType;
  status?: "processing" | "ready" | "failed" | "archived";
  /** null = organization-wide; set = only campaigns on that sending domain may use the list. */
  email_domain_id?: string | null;
  /** True for a list you did not collect yourself; it warms up more slowly. */
  acquired?: boolean | null;
  sunset_enabled?: boolean | null;
  quality_grade?: "green" | "yellow" | "red" | null;
  counts?: ContactListEmailCounts;
  /** Addresses removed before joining, by reason. */
  removed_at_upload?: Record<string, number>;
  last_send_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface ContactList {
  id?: string;
  name?: string;
  brand_id?: string | null;
  brand_name?: string | null;
  org_id?: string;
  org_name?: string;
  channels?: ContactListChannel[];
  /** The email side; null when the list has none. */
  email?: ContactListEmail | null;
  created_at?: string;
  [key: string]: unknown;
}

export type ContactListImportStatus =
  "uploading" | "processing" | "ready" | "failed";
export type ContactListAnalysisStatus =
  "not_started" | "processing" | "complete" | "failed";

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

export interface ContactListMergeTag {
  /** The merge tag name; use it in message content as `{tag}`. */
  tag?: string;
  /** The CSV column the tag reads. */
  column?: string;
  /** True for a standard field such as first_name; false for a custom tag. */
  standard?: boolean;
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
  channels?: ContactListChannel[];
  created_at?: string;
  /** The merge tags this list offers, one per mapped column; after an import without `merge_tags`, the tags assigned automatically. */
  available_merge_tags?: ContactListMergeTag[];
  import?: ContactListImportSection;
  analysis?: ContactListAnalysisSection;
  /** API URLs (send your X-API-Key; they do not expire). */
  downloads?: ContactListDownloads;
  /** The email side; null when the list has none. `email.status` replaces polling a separate email list. */
  email?: ContactListEmail | null;
  [key: string]: unknown;
}

export type ContactListDownloadType = "original" | "analyzed";

export interface ContactListDownloads {
  original_url?: string;
  /** Null until `analysis.status` is `complete`. */
  analyzed_url?: string | null;
  [key: string]: unknown;
}

export interface ListContactListsQuery {
  organization_id?: string;
  brand_id?: string;
  /** `text` (the default) lists the lists that hold phone numbers, `email` the ones that hold addresses, `all` both. */
  channel?: ContactListChannel | "all";
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

/** How the people in the imported file agreed to hear from you. */
export type ContactListConsentSource =
  | "donation_form"
  | "petition"
  | "signup_form"
  | "event"
  | "purchased"
  | "rented"
  | "other";

/**
 * `audience` (the default) makes a list you can send to. `do_not_contact`
 * makes the phones an opt-out list and the emails unsubscribes (visible on
 * GET /email/suppressions).
 */
export type ContactListImportPurpose = "audience" | "do_not_contact";

export interface ImportContactListRequest {
  /** HTTPS URL of the CSV (public or presigned), at most 50 MB, served as text/csv, application/csv, or text/plain. */
  source_url: string;
  organization_id?: string;
  brand_id?: string;
  /** 1-255 characters. */
  list_name: string;
  purpose?: ContactListImportPurpose;
  /** CSV column that holds the phone number. Send this, `email_column`, or both; the two must differ. */
  phone_column?: string;
  /**
   * CSV column that holds the email address. There is no automatic
   * detection. Needs email enabled for the organization (403
   * ENTITLEMENT_REQUIRED otherwise).
   */
  email_column?: string;
  /** Omit it (or map nothing) and every non-phone column gets a merge tag automatically. Supply it and phones map only the columns you name, while emails map the named columns and also every remaining column by its default name. With `email_column`, custom field names must match `^[a-z][a-z0-9_]{0,63}$`. Unknown keys are refused with a 400 (unknown top-level fields in the request are ignored). */
  merge_tags?: MergeTagMapping;
  /**
   * Optional. How the people on the list agreed to hear from you. Allowed
   * only when `purpose` is `audience` and `email_column` is set; refused
   * with a 400 otherwise. Omit it and no consent record is stored. Unknown
   * keys inside it are refused.
   */
  consent?: {
    source: ContactListConsentSource;
    /** Up to 1000 characters. */
    note?: string;
  };
  /** Scope the emails to one sending domain. Null or omitted: the whole organization. */
  email_domain_id?: string | null;
  /** Optional, default false. True marks the emails as purchased or rented; the list is sent more gradually (warms up on half steps). */
  acquired?: boolean;
}

/** An email side queued with the list. Poll GET /contact-lists/{list_id} and read `email.status`. */
export interface ContactListEmailImport {
  id?: string;
  status?: "queued";
  [key: string]: unknown;
}

interface ContactListImportResultBase {
  name?: string;
  status?: "processing";
  /** Null when the row count is not known yet. */
  total_rows?: number | null;
  channels?: ContactListChannel[];
  [key: string]: unknown;
}

/**
 * 202 Accepted for an `audience` import. Poll GET /contact-lists/{list_id}
 * for the phone side and `email.status` of the same response for the
 * email side. An email-only list belongs to the whole organization, with no
 * brand.
 */
export interface AudienceContactListImportResult extends ContactListImportResultBase {
  purpose: "audience";
  list_id: string;
  imported_via_api?: boolean;
  /** Present when the file had an email column. */
  email_import?: ContactListEmailImport;
}

/**
 * 202 Accepted for a `do_not_contact` import. No list id comes back: phones
 * become an opt-out list and emails become unsubscribes.
 */
export interface DoNotContactImportResult extends ContactListImportResultBase {
  purpose: "do_not_contact";
}

export type ContactListImportResult = AudienceContactListImportResult | DoNotContactImportResult;

/**
 * 202 Accepted (queued or already running), or 200 when nothing was left to
 * analyze (`analysis.status` `complete`, `cost_cents` 0). Poll
 * GET /contact-lists/{id} or subscribe to the `contact_list.analyzed` webhook.
 */
export interface ContactListAnalysisResult {
  list_id?: string;
  analysis?: {
    status?: "processing" | "complete";
    numbers_queued?: number;
    estimated_completion_seconds?: number;
    [key: string]: unknown;
  };
  /** Charged to the list's organization by this call; 0 when nothing was queued. */
  cost_cents?: number;
  [key: string]: unknown;
}

/**
 * 200 OK for DELETE /contact-lists/{id}. Removes the list's phone numbers
 * and its emails. A list referenced by any project
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

export type MediaStatus = "optimizing" | "ready" | "failed";

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
export type MediaUsage = "mms" | "email_asset";

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
  status?: "optimizing";
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

export type ProjectChannel = "10dlc" | "toll-free" | "short-code";
export type ProjectProtocol = "sms" | "mms";
export type ProjectType = "broadcast" | "survey" | "triggered";
export type ProjectStatsStatusFilter =
  "draft" | "active" | "completed" | "paused" | "all";

/** How often one person can enter a triggered project or campaign. */
export type TriggerReentry =
  | { mode: "once" }
  | { mode: "repeat"; /** 1-8760. */ min_gap_hours: number };

export type TriggerDonationProvider = "winred" | "anedot";

export interface TriggerDonation {
  /** 1-20 connected WinRed or Anedot lists. */
  integrations: Array<{ provider: TriggerDonationProvider; id: string }>;
  /** Default `any`. `first_time` means no earlier gift on record for the organization. */
  donor?: "any" | "first_time" | "returning";
  /** Default `any`. */
  gift?: "any" | "one_time" | "recurring";
  /** Dollars, inclusive. */
  amount_min?: number | null;
  amount_max?: number | null;
  /** Case-insensitive exact match; empty means any. */
  page_names?: string[];
  source_codes?: string[];
}

export type TriggerEventName =
  | "text_link_click"
  | "text_reply"
  | "email_open"
  | "email_click"
  | "email_reply";

export interface TriggerEvent {
  event: TriggerEventName;
  /**
   * `any`, or the ids of the projects (`text_*` events) or email campaigns
   * (`email_*` events) to watch. `any` never includes another triggered item.
   */
  sources: "any" | { ids: string[] };
  /** `email_click` only. */
  link_url?: string;
}

interface TriggerBase {
  /** 0-43200. Default 0 (immediately). */
  delay_minutes?: number;
  reentry?: TriggerReentry;
}

/**
 * When a triggered project or email campaign adds a recipient. Same shape for
 * text and email. `api` recipients arrive through `addProjectRecipient` /
 * `addEmailCampaignRecipient` or the inbound hook URL.
 */
export type Trigger =
  | (TriggerBase & { source: "api" })
  | (TriggerBase & { source: "donation"; donation: TriggerDonation })
  | (TriggerBase & { source: "event"; event: TriggerEvent });

/** Body for POST /projects/{id}/recipients. */
export interface AddProjectRecipientRequest {
  /** +1 E.164. */
  phone_number: string;
  /** Up to 50 keys, scalar values, each stored as a string up to 1024 chars. Merge tags in the message. */
  fields?: Record<string, string | number | boolean>;
  /** Up to 128 chars: your id for the event, so a retry of the same event is a no-op. */
  occurrence_id?: string;
}

/** Body for POST /email/campaigns/{id}/recipients. */
export interface AddEmailCampaignRecipientRequest {
  email: string;
  fields?: Record<string, string | number | boolean>;
  occurrence_id?: string;
}

/**
 * 202 `queued` (`send_at` is when it will send) or 200 `already_entered`
 * (`reason`: `duplicate`, `already_entered`, or `too_soon`). A paused item
 * answers 409 `CONFLICT`, an opted-out number 409 `CONTACT_OPTED_OUT`.
 */
export type AddRecipientResponse =
  | { status: "queued"; send_at: string }
  | {
      status: "already_entered";
      reason: "duplicate" | "already_entered" | "too_soon";
    };

/** 201 Created. The URL is shown only in this response; a new one replaces the old. */
export interface TriggerHookResponse {
  /** The hook with the secret in its path, for tools that can only be given a URL. */
  hook_url: string;
  /** The same hook with no secret in it; send `secret` in an `X-Hook-Secret` header. */
  endpoint_url: string;
  /** The hook secret. Shown only in this response. */
  secret: string;
}

/** Result of POST /projects/{id}/start. */
export interface StartProjectResult {
  project_id: string;
  status: "active";
  type: "triggered";
}

/** Result of POST /projects/{id}/end. Final. */
export interface EndProjectResult {
  project_id: string;
  status: "completed";
  type: ProjectType;
}

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

export type SurveyQuestionType =
  "intro" | "multiple_choice" | "open_ended" | "outro";

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
  /**
   * Why a paused project stopped; null when not paused. Known values:
   * `brand_daily_cap` (T-Mobile rejected messages over the daily cap;
   * `scheduleProject` resumes it: pass a morning `scheduled_at` inside the next
   * day's sending hours, or call without one to try T-Mobile again at the
   * reduced rate), `quiet_hours` (paused when
   * the sending window closes: 10 PM in the time zone of most recipients, or
   * 10 PM Pacific when no zone holds a majority; restart manually once the
   * window opens),
   * `carrier_block_rate`, `unregistered_campaign`,
   * `insufficient_funds_auto_recharge_failed`, `insufficient_funds_ancestor`,
   * `shared_phone_revoked`, `phone_released`, `organization_deleted`, and
   * `manual` or a short free-text reason (up to 100 characters) set by a user
   * who paused it. Other values may appear. Every auto-pause needs a manual
   * restart via `scheduleProject`.
   */
  pause_reason?: string | null;
  /** True when the platform paused the project itself, for example after T-Mobile rejected messages over the daily cap. */
  auto_paused?: boolean;
  /** Whether the project skips the reduced rate past the T-Mobile daily cap; set by the last schedule or resume call. */
  daily_cap_bypass?: boolean;
  created_via_api?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Survey projects only; absent on broadcast projects. */
  questions?: SurveyQuestion[];
  /** The trigger of a triggered project; null otherwise. */
  trigger?: Trigger | null;
  [key: string]: unknown;
}

export interface ListProjectsQuery {
  organization_id?: string;
  brand_id?: string;
  campaign_id?: string;
  type?: ProjectType;
}

interface CreateProjectBase {
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

/** A project that sends to contact lists (the default type). */
export interface CreateListProjectRequest extends CreateProjectBase {
  type?: "broadcast" | "survey";
  /**
   * Contact list IDs to send to. Optional: omitting it creates the project
   * in draft status, and it cannot be tested or scheduled until a list is
   * attached via PATCH /projects/{id}. An explicitly empty array is rejected.
   */
  contact_list_ids?: string[];
  suppression_list_ids?: string[];
}

/**
 * A triggered project has no contact list: recipients arrive when `trigger`
 * fires. `contact_list_ids` and `suppression_list_ids` are not accepted.
 * Test with `testProject`, then start with `startProject`.
 */
export interface CreateTriggeredProjectRequest extends CreateProjectBase {
  type: "triggered";
  trigger: Trigger;
}

export type CreateProjectRequest =
  CreateListProjectRequest | CreateTriggeredProjectRequest;

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
  /**
   * Editable while the project is draft, awaiting_test, ready, or paused.
   * Only organization_id and type are immutable.
   *
   * Sending any of channel, brand_id, campaign_id, or toll_free_verification_id
   * requires the full setup for the effective channel (the channel sent, else
   * the project's current one) plus phone_number_ids: 10dlc needs brand_id and
   * campaign_id (no toll_free_verification_id); toll-free needs
   * toll_free_verification_id (no brand_id or campaign_id); short-code takes
   * none of the three. Send new contact_list_ids, suppression_list_ids, and
   * media_ids in the same request when the old ones belong to the old brand
   * or registration (400 ASSET_OUT_OF_SCOPE). A suspended campaign returns
   * 409 CAMPAIGN_SUSPENDED and an expired one 409 CAMPAIGN_EXPIRED. Switching to toll-free or short-code clears the
   * brand and campaign.
   */
  channel?: ProjectChannel;
  /** Required with campaign_id when the effective channel is 10dlc; omit otherwise. */
  brand_id?: string;
  /** Required with brand_id when the effective channel is 10dlc; omit otherwise. */
  campaign_id?: string;
  /** Required when the effective channel is toll-free; omit otherwise. */
  toll_free_verification_id?: string;
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
  /** Triggered projects only. */
  trigger?: Trigger;
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

/** One answer option of a survey question. */
export interface SurveyOptionResult {
  value: number;
  label: string;
  count: number;
  percentage: number;
}

/** Results for one survey question. */
export interface SurveyQuestionResult {
  question_id: string;
  sequence: number;
  question_text: string;
  question_type: string;
  total_responses: number;
  option_results: SurveyOptionResult[];
  /** Replies that matched no option (or all replies, for open-ended questions). */
  other_count: number;
  other_percentage: number;
}

/**
 * GET /projects/{id}/survey-results response: topline survey results. The
 * numbers match the survey results page in the dashboard.
 */
export interface ProjectSurveyResults {
  project_id: string;
  name: string;
  status: string;
  total_recipients: number;
  /** Percentage of responding conversations that reached the final question. */
  completion_rate: number;
  dropoff_rate: number;
  /** One entry per question, ordered by sequence. */
  results: SurveyQuestionResult[];
}

/**
 * GET /projects/{id}/throughput response: how carrier limits will affect the
 * project. `recipients` and `carrier_coverage` are present only when
 * `carrier_metered` is true. A political brand with an AT&T rate on file
 * returns `carrier_metered: true`, `t_mobile: null` and a populated `att`. When coverage is low the per-carrier estimates
 * use the platform-wide carrier split. `will_pause` is always
 * false and `estimated_send_days` is always 1 (kept for compatibility). Results are cached up
 * to 60 seconds. A timed-out estimate throws a 503 `CARRIER_ESTIMATE_TIMEOUT`
 * error; retry later.
 */
export interface ProjectThroughput {
  project_id: string;
  carrier_metered: boolean;
  t_mobile: {
    /** Message parts per day; `used_today` and `remaining_today` are parts too. */
    daily_cap: number | null;
    /** Null (not 0) when usage is temporarily unavailable. */
    used_today: number | null;
    /** Null when `used_today` is null. */
    remaining_today: number | null;
    estimated_recipients: number;
    /** Always false: a project no longer pauses on the cap arithmetic, only on a carrier rejection. Kept for compatibility. */
    will_pause: boolean;
    /** Always 1. Kept for compatibility. */
    estimated_send_days: number;
  } | null;
  att: {
    /** The campaign's AT&T limit in message parts per minute for this project's protocol. */
    tpm: number;
    estimated_recipients: number;
    /** Minutes AT&T needs at `tpm` to deliver what the campaign already has waiting plus this project's AT&T recipients, accounting for the number of parts in the project's text. In practice AT&T recipients usually receive the message within about an hour of sending. */
    estimated_minutes: number;
  } | null;
  recipients?: number;
  /** Share of recipients whose carrier is known, 0 to 1. */
  carrier_coverage?: number;
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
    dateRange?: {
      earliestProject?: string | null;
      latestProject?: string | null;
    };
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
  /**
   * Merge-tag values for this contact, keyed by tag name. When supplied, no contact is
   * sampled from the project's lists for this test send and every tag renders from these
   * values, using the normal fallback chain (inline fallback, then org default, then
   * standard default, then empty) for any tag not present here.
   */
  merge_values?: Record<string, string>;
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
  | "America/New_York"
  | "America/Chicago"
  | "America/Denver"
  | "America/Los_Angeles"
  | "America/Anchorage"
  | "Pacific/Honolulu";

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
   * Skip the reduced rate past the brand's T-Mobile daily cap and send
   * T-Mobile recipients at full speed.
   *
   * Only meaningful for brands that have a T-Mobile daily limit on file
   * (political brands have none today): past the cap, their T-Mobile
   * recipients otherwise send at a reduced rate (about 300 message parts per
   * minute per campaign, rising to about 3,000 once receipts look healthy).
   * Ignored for brands with no cap.
   *
   * A carrier rejection still pauses a bypassed project, and rejected messages
   * are still billed. Defaults to false (reduced rate). Holds until the next schedule or resume call rewrites it, so
   * send it on every schedule or resume call. Scheduling also resumes a paused
   * project.
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
  /** Triggered projects only: enrolled, not yet sent. */
  waiting_recipients?: number;
  /** Triggered projects only: reason to count, e.g. `{ "opted_out": 2 }`. */
  skipped_recipients?: Record<string, number>;
  [key: string]: unknown;
}

export interface UnscheduleProjectResult {
  project_id?: string;
  status?: string;
  unscheduled_at?: string;
  [key: string]: unknown;
}

export interface PauseProjectRequest {
  /** Optional short reason (1-100 chars), returned as `pause_reason` on GET /projects/{id}. Defaults to `manual`. */
  reason?: string;
  [key: string]: unknown;
}

export interface PauseProjectResult {
  project_id?: string;
  /** Always `paused` on success. */
  status?: string;
  /** `manual`, the reason you sent, or the existing reason when the project was already paused. */
  pause_reason?: string | null;
  /** True only when the platform paused the project before this call. */
  auto_paused?: boolean;
  /** Kept from a paused `scheduled` project; null otherwise. */
  scheduled_at?: string | null;
  paused_at?: string;
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
// Conversations
//
// A conversation is one thread between one of the organization's sending
// numbers and one contact, created by a project send. The API never creates a
// conversation; it replies inside an existing one, from the same number, on
// the same project. Lists and single reads only ever surface conversations
// that have at least one inbound message.
// ---------------------------------------------------------------------------

export type ConversationStatus = "active" | "inactive" | "opted_out";

export interface ConversationContact {
  phone_number?: string;
  [key: string]: unknown;
}

/** GET /conversations/{id} response. */
export interface Conversation {
  conversation_id?: string;
  project_id?: string;
  from?: string;
  to?: string;
  /**
   * 'active': can still receive a reply. 'inactive': no recent activity but
   * not opted out. 'opted_out': the contact replied STOP; replies to this
   * conversation are refused with 409 CONTACT_OPTED_OUT.
   */
  status?: ConversationStatus;
  opted_out?: boolean;
  is_test?: boolean;
  contact?: ConversationContact;
  inbound_messages?: number;
  outbound_messages?: number;
  first_message_at?: string | null;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export type MessageDirection = "inbound" | "outbound";

/** Item returned by GET /conversations/{id}/messages. */
export interface ConversationMessage {
  message_id?: string;
  direction?: MessageDirection;
  text?: string;
  media_urls?: string[];
  status?:
    | "unsent"
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "failed"
    | "received"
    | "on_hold";
  sent_at?: string | null;
  delivered_at?: string | null;
  /** Set only on inbound messages; always null on outbound. */
  received_at?: string | null;
  /**
   * Delivery error code on a failed outbound message, in the same display form the
   * message.failed webhook and CSV exports use (e.g. "300", "012"). Opaque string;
   * null when the message did not fail or the failure was not a delivery result.
   */
  error_code?: string | null;
  /**
   * The contact's mobile carrier: the recipient's on outbound messages, the sender's on
   * inbound ones. Exactly "AT&T", "Verizon", or "T-Mobile" for the national networks
   * (brands and subsidiaries are reported under the network they run on); any other
   * carrier is its own registered name, an opaque string. null when unknown, and on
   * inbound messages received before this field was introduced.
   */
  carrier?: string | null;
  [key: string]: unknown;
}

export interface ListConversationsQuery {
  project_id?: string;
  /**
   * ISO 8601. Filters on last_inbound_at. Defaults to now minus 7 days on the
   * API; more than 90 days back is a 400.
   */
  updated_since?: string;
  /** Defaults to false on the API. */
  include_test?: boolean;
  /** 1-200, default 50. */
  limit?: number;
  cursor?: string;
}

export interface ListConversationMessagesQuery {
  /** 1-200, default 50. */
  limit?: number;
  cursor?: string;
}

export interface ReplyToConversationRequest {
  /**
   * Default "". Up to 10 SMS parts (1,530 GSM-7 or 670 Unicode characters), or
   * 1,500 characters with media; longer text is a 400 naming the limit.
   * Normalized for GSM before sending (curly quotes etc.). Optional when
   * `media_ids` has an entry; at least one of non-blank `text` or one media id
   * is required.
   */
  text?: string;
  /**
   * At most one media library id (the ids `createProject` accepts; list them
   * with `listMedia`). Sends the reply as one flat-rate MMS. An unusable id
   * (other organization, not ready, or a different brand than the project's)
   * is a 400 `MEDIA_NOT_USABLE` and nothing is charged.
   */
  media_ids?: string[];
}

/** 202 Accepted for POST /conversations/{id}/messages. */
export interface ReplyToConversationResult {
  message_id?: string;
  conversation_id?: string;
  project_id?: string;
  from?: string;
  to?: string;
  text?: string;
  /** CDN URLs of the attached media; empty for an SMS reply. */
  media_urls?: string[];
  created_at?: string;
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
// Email
//
// Write endpoints need the email entitlement on the organization and return
// 403 ENTITLEMENT_REQUIRED without it. Reads are open.
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
  type: "CNAME" | "TXT" | "MX";
  name: string;
  value: string | null;
  purpose?: string | null;
  [key: string]: unknown;
}

export interface EmailDomain {
  id: string;
  domain: string;
  status: "pending" | "active" | "failed";
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

// ---------------------------------------------------------------------------
// Webhook endpoints (read-only; created and edited in the dashboard)
// ---------------------------------------------------------------------------

/** An outbound webhook endpoint of your organization. The signing secret is never returned. */
export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  /** False when you or the platform switched the endpoint off. */
  enabled: boolean;
  /** Event names the endpoint is subscribed to, for example "message.delivered". */
  event_types: string[];
  /** Start of the current unbroken run of failed deliveries (ISO 8601); null while healthy. */
  failing_since: string | null;
  /**
   * Why the platform switched the endpoint off. Currently only
   * "consecutive_failures" (failing for 3 days with no successful delivery).
   * Null otherwise, and cleared when the endpoint is re-enabled.
   */
  disabled_reason: 'consecutive_failures' | null;
  created_at: string;
  updated_at: string;
}

export interface ListWebhookEndpointsQuery {
  /** Rows per page, 1-200. Defaults to 50. */
  limit?: number;
  /** Cursor from the previous page's `next_cursor`. */
  cursor?: string;
}

/** Status of this address in Google's Gmail Verified Sender Program, submitted through Campaign Verify. Read-only. */
export interface GmailVerifiedSender {
  status:
    | "not_eligible"
    | "eligible"
    | "ready_to_submit"
    | "submitted"
    | "verified"
    | "suspended"
    | "rejected"
    | "expired";
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
  status: "draft" | "active" | "paused";
  physical_address?: string | null;
  disclaimer?: string | null;
  disclaimer_required?: boolean;
  authorized_by_candidate?: boolean;
  gmail_verified_sender?: GmailVerifiedSender | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export type EmailSuppressionScope = "org" | "identity" | "domain";

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
  | "draft"
  | "awaiting_test"
  | "awaiting_approval"
  | "ready"
  | "scheduled"
  | "compiling"
  | "sending"
  | "paused"
  | "completed"
  | "deleted";

export interface EmailCampaignCounts {
  queued?: number;
  sent?: number;
  delivered?: number;
  bounced?: number;
  complained?: number;
  unsubscribed?: number;
  opened?: number;
  clicked?: number;
  /** Replies to a sequence email that came back through the platform. */
  replied?: number;
  failed?: number;
  [key: string]: unknown;
}

export type EmailCampaignApprovalStatus =
  "not_required" | "pending" | "approved" | "rejected";

export type EmailCampaignType = "broadcast" | "sequence" | "triggered";

export interface EmailCampaign {
  id: string;
  name: string;
  /** Fixed at creation. */
  type?: EmailCampaignType;
  /** The trigger of a triggered campaign; null otherwise. */
  trigger?: Trigger | null;
  status: EmailCampaignStatus;
  sender_identity_id: string;
  list_ids?: string[];
  suppression_list_ids?: string[];
  refcode?: string | null;
  source_code?: string | null;
  scheduled_at?: string | null;
  timezone?: string | null;
  /**
   * The sequence this campaign belongs to: the first email's id, which points
   * at itself. `null` for a broadcast.
   */
  sequence_id?: string | null;
  /** 1 for the first email of a sequence, 2 and up for its follow-ups. `null` for a broadcast. */
  sequence_position?: number | null;
  /** Sequence emails only: replies are forwarded to the sender's reply address and end that person's follow-ups. */
  stop_on_reply?: boolean;
  audience_count?: number | null;
  counts?: EmailCampaignCounts;
  /**
   * Why the campaign is paused. `api` is a pause made with `pauseEmailCampaign`;
   * `manual` is the dashboard; `provider_refused` waits for a person. Other
   * values are platform pauses that clear on their own once the cause does.
   */
  pause_reason?: string | null;
  /** When a planned resume will happen (set by `resumeEmailCampaign` with a future `resume_at`). `null` otherwise. */
  resume_at?: string | null;
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

export interface CreateEmailSequenceStepRequest {
  template_id: string;
  /** Defaults to the template's subject. */
  subject?: string;
  preheader?: string | null;
  /** Days after the previous email; 0 is later the same day. 0-365. */
  delay_days: number;
  /** Local time of day in the campaign's time zone, "HH:MM" (for example "08:30"). */
  send_time: string;
}

export interface CreateEmailSequenceRequest {
  /** Default true: a reply ends that person's follow-ups and is forwarded to the sender's reply address. */
  stop_on_reply?: boolean;
  /**
   * Default false. True sends each follow-up as a reply in the first email's
   * thread (In-Reply-To and References name the recipient's earlier emails,
   * subject "Re: <first email's subject>"); step subjects are then set for you.
   */
  thread_replies?: boolean;
  /** Up to 9 follow-ups, in order. */
  steps: CreateEmailSequenceStepRequest[];
}

export interface CreateEmailCampaignRequest {
  name: string;
  sender_identity_id: string;
  /** 1-50 list ids. Required unless `trigger` is set; cannot be combined with `trigger`. */
  list_ids?: string[];
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
   * Make this campaign the first email of a sequence: `steps` are its
   * follow-ups in order. Each sends `delay_days` after the previous email at
   * `send_hour` in the campaign's time zone, to the people the first email
   * reached, skipping anyone who replied (with `stop_on_reply`, the default),
   * unsubscribed, bounced or complained. Schedule the first email to schedule
   * them all; one test send tests every email.
   */
  sequence?: CreateEmailSequenceRequest;
  /**
   * Makes this a triggered campaign: no list, recipients arrive when the
   * trigger fires. Cannot be combined with `list_ids` or `sequence`. Start it
   * with `scheduleEmailCampaign` and no `scheduled_at`; stop it with
   * `endEmailCampaign`.
   */
  trigger?: Trigger;
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

export interface ResumeEmailCampaignInput {
  /** ISO 8601 date-time (Z or offset). Omit or `null` to resume now; more than a minute ahead plans the resume. */
  resume_at?: string | null;
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
  editor: "html" | "document";
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

export type EmailTemplateDraftStatus =
  "queued" | "running" | "ready" | "failed";

/**
 * INSUFFICIENT_BALANCE here means the wallet emptied mid-generation, which
 * leaves the draft failed and unbilled. A wallet that cannot cover the draft
 * up front is rejected at request time with a 402 instead, and no draft row
 * is created.
 */
export type EmailTemplateDraftErrorCode =
  "EMAIL_DRAFT_INVALID" | "EMAIL_DRAFT_MODEL_ERROR" | "INSUFFICIENT_BALANCE";
