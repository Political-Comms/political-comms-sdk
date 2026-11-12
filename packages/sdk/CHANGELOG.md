# Changelog

## [0.20.0] - 2026-11-12

### Added
- Triggered projects and email campaigns: items with no contact list whose recipients arrive when a trigger fires. New `Trigger` type (a union on `source`: `api`, `donation`, or `event`), with `TriggerDonation`, `TriggerEvent`, and `TriggerReentry`.
- `startProject(id)` starts or resumes a triggered project and `endProject(id)` ends it for good (`POST /projects/{id}/start` and `/end`).
- `addProjectRecipient(id, body)` and `addEmailCampaignRecipient(id, body)` add one recipient and resolve with `AddRecipientResponse`: `queued` (with `send_at`) or `already_entered` (with `reason`). `occurrence_id` makes a retry of the same event a no-op.
- `createProjectHook(id)` and `createEmailCampaignHook(id)` mint the inbound hook URL (`TriggerHookResponse`); the URL is shown once and replaces any previous one.
- `endEmailCampaign(id)` ends a triggered email campaign (`POST /email/campaigns/{id}/end`). Start one with `scheduleEmailCampaign(id)` and no `scheduled_at`.
- `CreateProjectRequest` is now a union: the existing list-based request, or `CreateTriggeredProjectRequest` (`type: 'triggered'`, `trigger`, no list ids). `ProjectType` gains `'triggered'`; `UpdateProjectRequest` and `ProjectDetail` gain `trigger`; `ProjectStatsRow` gains `waiting_recipients` and `skipped_recipients`.
- `CreateEmailCampaignRequest` gains `trigger`, and `list_ids` is optional when a trigger is given. `EmailCampaign` gains `type` (`broadcast`, `sequence`, or `triggered`) and `trigger`.

## [0.19.0] - 2026-11-10

### Breaking
- Breaking: `startEmailListImport` is removed, with `StartEmailListImportRequest`, `EmailListImport`, and `EmailListImportSummary`, because `POST /email/lists/import` no longer exists. `EmailListImportConsentSource` is now `ContactListConsentSource`. Use `importContactList` instead:
  - `name` becomes `list_name`, now required.
  - The `mapping` entry whose value is `email` becomes `email_column`; the email column is no longer detected automatically.
  - Other `mapping` entries become `merge_tags` (`first_name`, `last_name`, `address`, `address_line_2`, `city`, `state`, `zip`, `custom_fields`).
  - `email_domain_id` and `acquired` carry over unchanged; `consent` is now optional (allowed only for an audience list with an `email_column`).
  - Poll `getContactList(list_id)` for both sides: `import` is the phone side and `email.status` is the email side.
- Breaking: the `/email/lists` family is removed from the API (404, not deprecated), so these methods and types are removed: `listEmailLists`, `getEmailList`, `createEmailList`, `listEmailListContacts`, `addEmailListContacts`, `EmailList`, `EmailListCounts`, `EmailListSourceType`, `EmailConsentAttestation`, `ListEmailListsQuery`, `CreateEmailListRequest`. Migrate to the one list family on `/contact-lists`:
  - `listEmailLists` becomes `listContactLists({ channel: 'email' })` (or `'all'`); each row's email fields are under `email`.
  - `getEmailList(id)` becomes `getContactList(id)`; read the email fields under `email` (`email.status`, `email.counts`, `email.quality_grade`).
  - `createEmailList` and `addEmailListContacts` have no replacement: an email list is a contact list, and addresses reach it only through `importContactList` with `email_column` (a CSV import creates the list). `ListEmailContactsQuery`, `EmailListContact`, `EmailContactInput`, `EmailContactStatus`, `BulkUpsertResult`, and `RemoveEmailContactsResult` are removed with them.
  - `listEmailListContacts` has no replacement: read the counts with `getContactList(id)` (`email.counts`) and the unsubscribes and bounces with `listEmailSuppressions`.
- Breaking: `ContactListImportResult` is a union on `purpose`. A `do_not_contact` result has no `list_id` and no `imported_via_api`, so check `purpose` before reading `list_id`.

### Added
- `importContactList` is the one list import, for phones, emails, or both. `ImportContactListRequest` gains `purpose` (`audience` or `do_not_contact`), `email_column`, `consent`, `email_domain_id`, and `acquired`; `phone_column` is now optional (send it, `email_column`, or both). The result gains `purpose`, `channels`, and `email_import`.
- `ContactList` and `ContactListDetail` report `channels` (`text`, `email`) and `email` (a `ContactListEmail`, or null when the list has no email side).
- `listContactLists` accepts `channel` (`text`, the default, `email`, or `all`).

### Changed
- `deleteContactList` documents that it removes the list's emails too.

## [0.18.0] - 2026-10-31

### Added
- `getProjectSurveyResults(id)` returns topline survey results for a survey project (`GET /projects/{id}/survey-results`), with `ProjectSurveyResults`, `SurveyQuestionResult`, and `SurveyOptionResult` types. Non-survey projects return a 409 `NOT_A_SURVEY` error.
- `replyToConversation` accepts `media_ids` (one media library id) to send the reply as an MMS, and `text` is now optional when a media id is given.
- Phone number records document when the organization acquired the number; a number released and bought again is a new record with a new `id`.

### Changed
- `getProjectThroughput` and its types now report recipients per carrier and how long AT&T takes; `will_pause` is always false and `estimated_send_days` is always 1, kept for compatibility.
- Past a brand's T-Mobile daily limit, T-Mobile recipients send at a reduced rate instead of pausing; only a carrier rejection pauses the project. `daily_cap_bypass` now skips the reduced rate.
- Resuming a `brand_daily_cap` pause with `scheduleProject` without a `scheduled_at` tries T-Mobile again at the reduced rate.

## [0.17.1] - 2026-10-13

### Changed
- The T-Mobile daily cap and AT&T limits are documented in message parts, so a two-part text counts twice.

## [0.17.0] - 2026-10-10

### Added
- `updateProject` accepts `channel`, `brand_id`, `campaign_id`, and `toll_free_verification_id` to change a project's sending setup.
- `ProjectChannel` includes `short-code`.

### Fixed
- `updateProject` documents that paused projects are editable and that an edit moves the project to `awaiting_test`.

## [0.16.0] - 2026-10-07

Previously published baseline: `pauseProject` (`POST /projects/{id}/pause`).
