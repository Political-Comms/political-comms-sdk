# Changelog

## [0.23.0] - 2026-11-17

### Breaking
- Breaking: the `trigger` parameter no longer takes `reentry`. A phone number or email address is sent a triggered project or campaign at most once; drop the field. `add_project_recipient` and `add_email_campaign_recipient` no longer describe a `too_soon` reason.

### Added
- Trigger start time and tag triggers on `create_project`: `trigger.start` (`immediate` or `next_day`), `trigger.source` `tag` with `tag.tag_ids`, and `scheduled_timezone` and `sequence_send_time`. `start_project` and `schedule_email_campaign` take `audience` (`current_and_new` or `new_only`), required for a tag trigger's first start.
- `create_project` takes `follow_ups` (up to 9 steps of `message_text`, `media_ids`, and `wait`, with `stop_on_reply` and `stop_on_click`). Its description states the stop rules, the once-per-person rule for triggered projects, and that each follow-up is charged when it sends.
- `add_tag_contacts` and `import_contact_list` take `fire_triggers`. Their descriptions tell the agent plainly that tagging into a tag with live triggers messages people, to read `live_triggers` from `list_tags` first, and to get the user's explicit yes before sending `fire_triggers: true` for a list or an import. `list_tags` describes `live_triggers`.
- `list_tags`, `create_tag`, `rename_tag`, and `add_tag_contacts` (by `identifiers` or `contact_list_id`; requires `confirm: true` because it changes who a send reaches). `add_tag_contacts` names the tag by `id` or by `name` (exactly one, with an optional `organization_id` for a name); a name creates the tag when the organization has none, and the result carries the `tag` and `created`. Its description tells the agent to pass a name as `list_tags` returned it so it does not create a near-duplicate. Deleting a tag and untagging contacts are not tools: the server exposes no delete operations.
- `create_project` takes `tag_ids` (send to contacts carrying ANY of these tags, in union with the lists), `require_tag_ids` (keep only contacts carrying ALL of them), and `suppression_tag_ids`. Its description states the consent rule: a tagged contact is only sent to through a list row the sender can use.
- `import_contact_list` takes `tag_ids`, `tag_names`, and `tags_column` for an audience import.
- `get_contact_list` passes through `import.error` and `email.error` (`{ code, message }`, null unless that side failed), and its description tells the agent the message is safe to show the user.
- `POLITICAL_COMMS_BASE_URL` points the server at another API host.

### Fixed
- `create_project` without `contact_list_ids` sent an empty array, which the API refuses; it now leaves the field out, so a draft or a tags-only project can be created.

### Changed
- Requires `@political-comms/sdk` ^0.24.0.
- Behavior change: `add_tag_contacts` with `contact_list_id` returns `queued: true` and a `job_id` with no counts. Tagging or untagging by `contact_list_id` is queued, a change made the same day this release was prepared: the API answers 202 with `{ queued: true, job_id }` (by name, plus `tag` and `created`) and no counts; there is no job status endpoint, and the outcome shows as the tag's `member_count` once the job finishes. The tool description tells the agent the work continues in the background and to read the outcome from `list_tags` `member_count`.
- `create_project` no longer describes `tag_ids` as refused by survey projects.

## [0.22.1] - 2026-11-16

### Changed
- The `get_project_stats` tool description mentions `cost_breakdown`: messages, segments, and cost per product, summing to the project total.

## [0.22.0] - 2026-11-13

### Added
- The `test_project` tool description now says numbers ending 555-0100 to 555-0199 are test phone numbers that never reach a phone and return a fixed outcome.
- `list_webhook_endpoints` and `get_webhook_endpoint` read the organization's outbound webhook endpoints and their delivery health (`enabled`, `failing_since`, `disabled_reason`). Both are read-only; the signing secret is never returned.

### Changed
- Requires `@political-comms/sdk` ^0.22.0.

## [0.21.0] - 2026-11-13

### Added
- `pause_email_campaign` pauses a scheduled, compiling, or sending email campaign (`pause_reason: api`). It does not need `confirm`: like `pause_project`, it only stops sending.
- `resume_email_campaign` resumes a paused campaign now, or at `resume_at`. It sends mail, so it requires `confirm: true`.

### Changed
- Requires `@political-comms/sdk` ^0.21.0.

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
