# Changelog

## [0.20.0] - 2026-11-12

### Added
- Triggered projects and email campaigns (no contact list; each recipient gets one message when a trigger fires). New tools: `start_project`, `end_project`, `add_project_recipient`, `create_project_hook`, `end_email_campaign`, `add_email_campaign_recipient`, and `create_email_campaign_hook`.
- `start_project`, `add_project_recipient`, and `add_email_campaign_recipient` send real messages and require `confirm: true`. `end_project`, `end_email_campaign`, and the two hook tools are annotated destructive because ending is final and a new hook URL replaces the old one.
- `create_project` accepts `type` (`broadcast`, `survey`, or `triggered`) and `trigger`.

### Changed
- `create_project` no longer lists `contact_list_ids` as required, because a triggered project takes none. Other project types still need it.
- Requires `@political-comms/sdk` ^0.20.0.

## [0.19.0] - 2026-11-10

### Breaking
- Breaking: the `start_email_list_import` tool is removed, because `POST /email/lists/import` no longer exists. Use `import_contact_list` instead: `name` becomes `list_name` (required), the `mapping` entry whose value is `email` becomes `email_column` (no automatic detection), other `mapping` entries become `merge_tags`, and `consent_source` and `consent_note` are now optional, while `email_domain_id` and `acquired` carry over.
- Breaking: the `list_email_lists` tool is removed, because `GET /email/lists` no longer exists. Use `list_contact_lists` with `channel` `email` (or `all`); each list's email fields are under `email`. For one list, use `get_contact_list` and read `email.status`. Email addresses reach a list only through `import_contact_list` with `email_column`; read unsubscribes and bounces with `list_email_suppressions`.

### Added
- `list_contact_lists` and `get_contact_list` return `email` (the list's email side, or null).
- `import_contact_list` tool imports a CSV as a new list of phones, emails, or both, or as a do-not-contact list (`purpose`). Requires `confirm: true`.
- `list_contact_lists` accepts `channel` (`text`, the default, `email`, or `all`) and returns each list's `channels`.

### Fixed
- The server instructions no longer name `create_email_template_draft`, a tool the server does not have.

### Changed
- Requires `@political-comms/sdk` 0.19.
- The server reports version 0.19.0.

## [0.18.0] - 2026-10-31

### Added
- `get_project_survey_results` tool returns topline survey results for a survey project. Non-survey projects return a 409 `NOT_A_SURVEY` error.
- `reply_to_conversation` accepts `media_ids` (one media library id) to send an MMS reply, and `text` is optional when a media id is given.

### Changed
- `get_project_throughput`, `get_campaign_throughput`, and `schedule_project` descriptions reflect that T-Mobile recipients send at a reduced rate past the daily limit, that `will_pause` is always false, and that AT&T limits are counted in message parts.
- `schedule_project` documents that calling it without `scheduled_at` on a `brand_daily_cap` pause tries T-Mobile again at the reduced rate.
- The server reports version 0.18.0.

## [0.17.0] - 2026-10-10

### Changed
- `update_project` documents that paused projects are editable and that the sending setup (`channel`, `brand_id`, `campaign_id`, `toll_free_verification_id`) can be changed.

## [0.16.0] - 2026-10-07

Previously published baseline: `pause_project`.
