# Changelog

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
