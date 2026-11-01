# Changelog

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
