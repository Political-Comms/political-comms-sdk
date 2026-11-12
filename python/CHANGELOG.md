# Changelog

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
