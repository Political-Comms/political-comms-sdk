# Changelog

## [0.22.0] - 2026-11-17

### Added
- Contact tags: `list_tags(organization_id=)`, `create_tag(name)` or `create_tag(activity_event=, within_days=)`, `rename_tag(id, name)`, `delete_tag(id)`, `add_tag_contacts(id, identifiers)` or `add_tag_contacts(id, contact_list_id=)`, and `remove_tag_contacts` with the same arguments (`GET /tags`, `POST /tags`, `PATCH /tags/{id}`, `DELETE /tags/{id}`, `POST /tags/{id}/contacts`, `DELETE /tags/{id}/contacts`). `delete_tag` and `remove_tag_contacts` need an API key with the `public:delete` permission. A 409 `TAG_IN_USE` from `delete_tag` lists the live sends using the tag in `body["details"]`.
- `tag_ids` (send to contacts carrying ANY of these tags, in union with the lists), `require_tag_ids` (keep only contacts carrying ALL of them), and `suppression_tag_ids` on `create_project`, `update_project`, and `create_email_campaign`. A tagged contact is only sent to through a list row the sender can use.
- `tag_ids`, `tag_names`, and `tags_column` on `import_contact_list` tag every contact of an `audience` import.

### Changed
- `update_project` sends an empty `contact_list_ids`, `suppression_list_ids`, or `media_ids` list instead of dropping it, so `[]` clears the field (`contact_list_ids=[]` is accepted while the project keeps a tag). `None` still leaves a field unchanged.
- `create_email_campaign` no longer needs `list_ids` when `tag_ids` is set.

## [0.21.2] - 2026-11-16

### Changed
- `get_project_stats(id)` documents the new `cost_breakdown` list: the project's cost per product (`code`, `messages`, `segments`, `cost`), net of refunds and summing to the project total. Documentation only: the client returns the response as-is.

## [0.21.1] - 2026-11-16

### Changed
- `delete_contact_list`, `delete_media`, and `remove_email_suppressions` need an API key with the `public:delete` permission (and `public:write`); other keys get a 403. Keys created before this change keep working. Documentation only: no runtime change.

## [0.21.0] - 2026-11-13

### Added
- `list_webhook_endpoints(limit=, cursor=)` and `get_webhook_endpoint(id)` read your organization's outbound webhook endpoints (`GET /webhook-endpoints`, `GET /webhook-endpoints/{id}`). Read-only: endpoints and their signing secret are managed in the dashboard. The list is keyset paginated and needs an API key with the `public:read` scope.
- Each endpoint carries `failing_since` (start of the current run of failed deliveries, or `None` while healthy) and `disabled_reason` (`"consecutive_failures"` after 3 days with no successful delivery, cleared when re-enabled).

## [0.20.0] - 2026-11-13

### Added
- `pause_email_campaign(id)` pauses a scheduled, compiling, or sending email campaign (`pause_reason` is `api`; the platform never resumes it).
- `resume_email_campaign(id, resume_at=None)` resumes a paused campaign now, or at `resume_at` when it is more than a minute ahead. It can raise `409 SENDING_PAUSED` or `409 EMAIL_CAMPAIGN_TEST_REQUIRED`.
- Email campaigns carry a new `resume_at` field.

## [0.19.0] - 2026-11-12

### Added
- Triggered projects and email campaigns: items with no contact list whose recipients arrive when a trigger fires.
- `start_project(id)`, `end_project(id)`, `add_project_recipient(id, phone_number, fields=, occurrence_id=)`, and `create_project_hook(id)`.
- `end_email_campaign(id)`, `add_email_campaign_recipient(id, email, fields=, occurrence_id=)`, and `create_email_campaign_hook(id)`. Start a triggered campaign with `schedule_email_campaign(id)` and no `scheduled_at`.
- `create_project` and `update_project` accept `trigger`, and `create_project` accepts `type` (`"triggered"` takes no list ids).
- `create_email_campaign` accepts `trigger`, and `list_ids` is now optional (required unless a trigger is given).

## [0.18.0] - 2026-11-10

### Breaking
- Breaking: `start_email_list_import` is removed, because `POST /email/lists/import` no longer exists. Use `import_contact_list` instead:
  - `name` becomes `list_name`, now required.
  - The `mapping` entry whose value is `email` becomes `email_column`; the email column is no longer detected automatically.
  - Other `mapping` entries become `merge_tags` (`first_name`, `last_name`, `address`, `address_line_2`, `city`, `state`, `zip`, `custom_fields`).
  - `email_domain_id` and `acquired` carry over unchanged; `consent` is now optional (allowed only for an audience list with an `email_column`).
  - Poll `get_contact_list(list_id)` for both sides: `import` is the phone side and `email.status` is the email side.
- Breaking: the `/email/lists` family is removed from the API (404, not deprecated), so these methods are removed: `list_email_lists`, `get_email_list`, `create_email_list`, `list_email_list_contacts`, `add_email_list_contacts`. Migrate to the one list family on `/contact-lists`:
  - `list_email_lists()` becomes `list_contact_lists(channel="email")` (or `"all"`); each row's email fields are under `email`.
  - `get_email_list(id)` becomes `get_contact_list(id)`; read the email fields under `email` (`email.status`, `email.counts`, `email.quality_grade`).
  - `create_email_list` and `add_email_list_contacts` have no replacement: an email list is a contact list, and addresses reach it only through `import_contact_list` with `email_column` (a CSV import creates the list).
  - `list_email_list_contacts` has no replacement: read the counts with `get_contact_list(id)` (`email.counts`) and the unsubscribes and bounces with `list_email_suppressions`.
- Breaking: a `do_not_contact` import returns no `list_id`; check `data["purpose"]` before reading it.

### Added
- `import_contact_list` is the one list import, for phones, emails, or both. It gains `purpose` (`"audience"` or `"do_not_contact"`), `email_column`, `consent`, `email_domain_id`, and `acquired` keyword arguments; `phone_column` is now optional. The result reports `purpose`, `channels`, and, when the file had emails, `email_import`.
- `get_contact_list` and each `list_contact_lists` row report `email` (the list's email side, or null).
- `list_contact_lists` accepts `channel` (`"text"`, the default, `"email"`, or `"all"`); each list reports its `channels`.

### Changed
- `delete_contact_list` documents that it removes the list's emails too.

## [0.17.0] - 2026-10-31

### Added
- `get_project_survey_results(id)` returns topline survey results for a survey project (`GET /projects/{id}/survey-results`). Non-survey projects raise a 409 `NOT_A_SURVEY` error.
- `reply_to_conversation` accepts `media_ids` (one media library id) to send an MMS reply, and `text` defaults to an empty string.

### Changed
- `get_project_throughput` docs describe recipients per carrier and how long AT&T takes; `will_pause` is always false and `estimated_send_days` is always 1.
- `schedule_project` docs explain that T-Mobile recipients past the daily limit send at a reduced rate and that `daily_cap_bypass` skips it.
- AT&T and T-Mobile limits are documented in message parts, so a two-part text counts twice.

## [0.16.0] - 2026-10-10

### Added
- `update_project` accepts `channel`, `brand_id`, `campaign_id`, and `toll_free_verification_id` to change a project's sending setup.

### Fixed
- `update_project` documents that paused projects are editable and that an edit moves the project to `awaiting_test`.

## [0.15.0] - 2026-10-07

Previously published baseline: `pause_project`.
