# Changelog

## [0.24.0] - 2026-11-17

### Breaking
- Breaking: `TriggerReentry` and `Trigger.reentry` are removed. A phone number or email address is sent a triggered project or campaign at most once; the API ignores a sent-back `{ mode: "once" }` and refuses any other value (400 at `trigger.reentry`). Drop the field.
- Breaking: `too_soon` is removed from `AddRecipientResponse.reason`. A repeat is `already_entered` (the person was already sent this item) or `duplicate` (a repeated `occurrence_id`).
- Breaking: `EmailCampaignType` no longer includes `sequence`. A campaign with follow-ups reads `broadcast`; `sequence_id` and `sequence_position` still say where it sits.
- Breaking: `startProject(id, body?, options?)` takes a `StartProjectRequest` body second, as `pauseProject` does; move request options to the third argument.

### Added
- A triggered email campaign accepts `sequence` (follow-ups). Beside `trigger` each `delay_days` is 1 to 365 and counts from the day that person's previous email was sent.
- Trigger start time: `Trigger.start` (`TriggerStart`: `immediate`, the default, or `next_day`, the day after the trigger fired with `delay_minutes` 0). A text project names when with `scheduled_timezone` and `sequence_send_time` ("HH:MM") on `CreateProjectRequest`, `UpdateProjectRequest`, and `ProjectDetail`; an email campaign with `timezone` and `sequence_send_time` on `CreateEmailCampaignRequest` and `EmailCampaign`.
- Tag triggers: `Trigger` gains `{ source: "tag", tag: TriggerTag }` (`tag_ids`, 1-20 manual tags). The first start takes `audience` (`TriggerAudience`: `current_and_new` or `new_only`) on `StartProjectRequest` and `ScheduleEmailCampaignRequest`.
- `Tag.live_triggers` (`TagLiveTrigger[]`: `id`, `name`, `channel`): the started triggered items listening for the tag. `fire_triggers` on `AddTagContactsRequest` (new; `addTagContacts` takes it), `TagContactsByNameRequest`, and `ImportContactListRequest`, defaulting to true for `identifiers` and false for a list or an import; `UntagContactsByNameRequest` (for `untagContacts`) has none. `AddTagContactsCounts.triggers.entered`, `TagContactsQueuedResult.fire_triggers`, and `AudienceContactListImportResult.fire_triggers` report it.
- Text follow-ups: `follow_ups` (`ProjectFollowUps`: 1-9 `ProjectFollowUpStep` of `message_text`, `media_ids`, and `wait` `ProjectFollowUpWait`, with `stop_on_reply` and `stop_on_click`) on `CreateProjectRequest` and `UpdateProjectRequest` (`null` clears); `ProjectDetail.follow_ups` (`ProjectFollowUpsDetail`, media by URL). Broadcast and triggered projects only. `ProjectStats.exited_recipients`.
- Email follow-ups: `CreateEmailSequenceRequest.stop_on_click` and `EmailCampaign.stop_on_click`.
- Email follow-ups can wait hours: `CreateEmailSequenceStepRequest` is now `CreateEmailSequenceDaysStep` (`delay_days` with `send_time`) or `CreateEmailSequenceHoursStep` (`delay_hours`, 1-72), so a step that gives both does not compile. `EmailCampaign.sequence` (`EmailCampaignSequence`, returned by `getEmailCampaign`) lists `EmailSequenceStep` items with `delay_days`, `delay_hours` (`number | null`) and `send_time`; an hour step has `delay_days` and `send_time` null.
- Contact tags: `listTags({ organization_id? })`, `createTag(body)` (a manual tag by `name`, or an activity tag by `activity_event` and optional `within_days`), `renameTag(id, { name })`, `deleteTag(id)`, `addTagContacts(id, body)`, and `removeTagContacts(id, body)` (`GET /tags`, `POST /tags`, `PATCH /tags/{id}`, `DELETE /tags/{id}`, `POST /tags/{id}/contacts`, `DELETE /tags/{id}/contacts`). Contacts are added or removed by `identifiers` (US phone numbers or email addresses, up to 10000) or by `contact_list_id`. `deleteTag` and `removeTagContacts` need an API key with the `public:delete` permission.
- Tagging by name: `tagContacts(body)` (`POST /tags/contacts`) tags contacts with the manual tag of that `name`, creating it when the organization has none (matched ignoring case); the result carries the `tag` and `created`, true only when this call created it. `untagContacts(body)` (`DELETE /tags/contacts`) removes them and never creates a tag (404 `NOT_FOUND` for an unknown name); it needs the `public:delete` permission. Both take `identifiers` or `contact_list_id` and an optional `organization_id`. Types `TagContactsByNameRequest`, `TagContactsByNameResult`, and `UntagContactsByNameResult`.
- `Tag`, `TagKind`, `TagActivityEvent`, `ListTagsQuery`, `CreateTagRequest` (`CreateManualTagRequest | CreateActivityTagRequest`), `RenameTagRequest`, `TagContactsRequest`, `AddTagContactsResult`, `RemoveTagContactsResult`, `DeleteTagResult`, `TagInUseDetails`, `TagInUseSend`, `ProjectTagRef`, and `SendTagFields` types. A 409 `TAG_IN_USE` from `deleteTag` carries `TagInUseDetails` in `error.body.details`.
- `tag_ids` (send to contacts carrying ANY of these tags, in union with the lists), `require_tag_ids` (keep only contacts carrying ALL of them), and `suppression_tag_ids` on `CreateProjectRequest`, `UpdateProjectRequest`, `ProjectDetail`, `Project` (which also names them in `source_tags`, `required_tags`, and `suppression_tags`), `CreateEmailCampaignRequest`, and `EmailCampaign`. A tagged contact is only sent to through a list row the sender can use.
- `tag_ids`, `tag_names`, and `tags_column` on `ImportContactListRequest` tag every contact of an `audience` import.
- `ContactListImportSection.error` and `ContactListEmail.error` (`ContactListImportError`, `{ code, message } | null`): why a failed import side failed, for example `TAG_COLUMN_TOO_MANY_TAGS`, or `IMPORT_FAILED` for an internal failure. Null unless that side's status is `failed`.
- `TagContactsQueuedResult`, `AddTagContactsCounts`, and `RemoveTagContactsCounts` types.

### Changed
- Behavior change: Tagging or untagging by `contact_list_id` is queued, a change made the same day this release was prepared: the API answers 202 with `{ queued: true, job_id }` (by name, plus `tag` and `created`) and no counts; there is no job status endpoint, and the outcome shows as the tag's `member_count` once the job finishes. `AddTagContactsResult`, `RemoveTagContactsResult`, `TagContactsByNameResult`, and `UntagContactsByNameResult` are now unions of the counts and `TagContactsQueuedResult`; narrow on `queued`. The client resolves the 202 like any success.
- Survey projects take `tag_ids`, `require_tag_ids`, and `suppression_tag_ids` like broadcast projects; only triggered projects refuse them. The doc comments said surveys refused them.
- The README states the key permission rule: GET needs `public:read`; POST, PATCH, and PUT need `public:write`; DELETE needs `public:write` and `public:delete`. A write-only key can now write.
- `CreateEmailCampaignRequest.list_ids` is documented as optional when `tag_ids` is set, and `UpdateProjectRequest.contact_list_ids` accepts `[]` while the project keeps a tag.

### Fixed
- Survey projects could not be created: the survey create type required `protocol` and `message_text`, which the API refuses on a survey, and had no `questions`, which it requires, so every survey create was a 400. `CreateProjectRequest` is now a union on `type` of `CreateListProjectRequest` (broadcast), `CreateSurveyProjectRequest` (`campaign_id`, `questions` as `SurveyQuestionInput[]` with `SurveyQuestionOptionInput` response options, the list and tag fields, link tracking, `ai_survey_analysis_enabled`), and `CreateTriggeredProjectRequest`. `UpdateProjectRequest` is now `UpdateMessageProjectRequest | UpdateSurveyProjectRequest`; a survey's `questions` replaces the whole set. A body that mixes a survey's fields with a message's (`message_text`, `protocol`, `media_ids`, `follow_ups`, and the like) no longer compiles.
- `CreateEmailCampaignRequest.sequence` documented a `send_hour` field; the step field is `send_time`.

## [0.23.0] - 2026-11-16

### Added
- `ProjectStats.cost_breakdown` and the `ProjectCostBreakdownEntry` type: `getProjectStats(id)` returns the project's cost per product (`sms_outbound`, `mms_outbound`, `sms_inbound`, `mms_inbound`, and RCS when used), each with `messages`, `segments`, and `cost`, net of refunds and summing to the project total. `messages` is `null` when the billing record cannot state a count.

## [0.22.1] - 2026-11-16

### Changed
- `deleteContactList`, `deleteMedia`, and `removeEmailSuppressions` need an API key with the `public:delete` permission (and `public:write`); other keys get a 403. Keys created before this change keep working. Documentation only: no runtime change.

## [0.22.0] - 2026-11-13

### Added
- `listWebhookEndpoints({ limit?, cursor? })` and `getWebhookEndpoint(id)` read your organization's outbound webhook endpoints (`GET /webhook-endpoints`, `GET /webhook-endpoints/{id}`). Read-only: endpoints and their signing secret are managed in the dashboard. The list is keyset paginated (`{ data, has_more, next_cursor }`) and needs an API key with the `public:read` scope.
- `WebhookEndpoint` and `ListWebhookEndpointsQuery` types. `failing_since` is the start of the current run of failed deliveries (`null` while healthy); `disabled_reason` is `consecutive_failures` after 3 days with no successful delivery, and is cleared when the endpoint is re-enabled.

## [0.21.0] - 2026-11-13

### Added
- `pauseEmailCampaign(id)` pauses a scheduled, compiling, or sending email campaign (`POST /email/campaigns/{id}/pause`). The `pause_reason` is `api`, and the platform never resumes an `api` pause by itself.
- `resumeEmailCampaign(id, { resume_at }?)` resumes a paused campaign now, or at `resume_at` when it is more than a minute ahead (`POST /email/campaigns/{id}/resume`). It can return `409 SENDING_PAUSED` or `409 EMAIL_CAMPAIGN_TEST_REQUIRED`.
- `ResumeEmailCampaignInput` type, and `EmailCampaign` gains `resume_at` (the time a planned resume will happen, or `null`).

### Changed
- The `pause_reason` doc comment no longer lists `provider_error`; the API no longer returns it.

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
