# Changelog

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
