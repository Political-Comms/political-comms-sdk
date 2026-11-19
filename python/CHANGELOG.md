# Changelog

## [0.23.0] - 2026-11-18

### Added
- `create_project` and `update_project` take `link_tracking_links`: a list of up to 3 tracked links per message, in tag order (`{tracking_url}`, `{tracking_url_2}`, `{tracking_url_3}`), each `{"destination_url", "param_fields", "fallback_url"}` with up to 10 `param_fields`. `link_tracking_destination_url`, `link_tracking_param_field`, and `link_tracking_fallback_url` stay as aliases for the first link; sending them with `link_tracking_links` is a 400.

## [0.22.0] - 2026-11-17

### Breaking
- Breaking: a trigger's `reentry` is gone from the docs and examples. A phone number or email address is sent a triggered project or campaign at most once; the API ignores a sent-back `{"mode": "once"}` and refuses any other value (400 at `trigger.reentry`). Drop the key.
- Breaking: `add_project_recipient` and `add_email_campaign_recipient` no longer answer `reason` `"too_soon"`. A repeat is `"already_entered"` (the person was already sent this item) or `"duplicate"` (a repeated `occurrence_id`).
- Breaking: an email campaign's `type` is only `"broadcast"` or `"triggered"`; a campaign with follow-ups reads `"broadcast"`, not `"sequence"`.

### Added
- `get_project_stats(id)` documents `replies` on each `cost_breakdown` entry: `{"messages", "segments", "cost"}` for the part of an outbound product that is the automatic STOP, START, and HELP replies (included in the entry, not added on top), or `None`. Documentation only: the client returns the response as-is.
- `create_email_campaign` accepts `sequence` beside `trigger`. Each step's `delay_days` is then 1 to 365 and counts from the day that person's previous email was sent.
- Trigger start time: a trigger's `start` (`"immediate"`, the default, or `"next_day"`). `create_project` and `update_project` take `scheduled_timezone` and `sequence_send_time`; `create_email_campaign` takes `timezone` and `sequence_send_time`.
- Tag triggers: `{"source": "tag", "tag": {"tag_ids": [...]}}`. `start_project(id, audience=)` and `schedule_email_campaign(id, audience=)` take `"current_and_new"` or `"new_only"`, required for a tag trigger's first start.
- `fire_triggers` on `add_tag_contacts`, `tag_contacts`, and `import_contact_list`; results carry `triggers["entered"]` (or echo `fire_triggers` when queued). `list_tags` documents each tag's `live_triggers`.
- Text follow-ups: `follow_ups` on `create_project` and `update_project` (`clear_follow_ups=True` sends `null` to remove them); `get_project` returns them with media by URL.
- Email follow-ups: `sequence` takes `stop_on_click` beside `stop_on_reply`.
- Email follow-ups can wait hours: a `sequence` step gives either `delay_days` with `send_time` or `delay_hours` (1 to 72) alone; `get_email_campaign` returns `sequence["steps"]` with `delay_hours` (`None` for a day step) and, for an hour step, `delay_days` and `send_time` `None`.
- Contact tags: `list_tags(organization_id=)`, `create_tag(name)` or `create_tag(activity_event=, within_days=)`, `rename_tag(id, name)`, `delete_tag(id)`, `add_tag_contacts(id, identifiers)` or `add_tag_contacts(id, contact_list_id=)`, and `remove_tag_contacts` with the same arguments (`GET /tags`, `POST /tags`, `PATCH /tags/{id}`, `DELETE /tags/{id}`, `POST /tags/{id}/contacts`, `DELETE /tags/{id}/contacts`). `delete_tag` and `remove_tag_contacts` need an API key with the `public:delete` permission. A 409 `TAG_IN_USE` from `delete_tag` lists the live sends using the tag in `body["details"]`.
- Tagging by name: `tag_contacts(name, identifiers)` or `tag_contacts(name, contact_list_id=)` (`POST /tags/contacts`) tags contacts with the manual tag of that name, creating it when the organization has none (matched ignoring case); the result carries the `tag` and `created`, true only when this call created it. `untag_contacts` takes the same arguments (`DELETE /tags/contacts`), never creates a tag (404 `NOT_FOUND` for an unknown name), and needs the `public:delete` permission. Both take an optional `organization_id`.
- `tag_ids` (send to contacts carrying ANY of these tags, in union with the lists), `require_tag_ids` (keep only contacts carrying ALL of them), and `suppression_tag_ids` on `create_project`, `update_project`, and `create_email_campaign`. A tagged contact is only sent to through a list row the sender can use.
- `tag_ids`, `tag_names`, and `tags_column` on `import_contact_list` tag every contact of an `audience` import.
- `get_contact_list` documents `import.error` and `email.error` (`{"code", "message"}` or `None`): why a failed import side failed.

### Changed
- Behavior change: Tagging or untagging by `contact_list_id` is queued, a change made the same day this release was prepared: the API answers 202 with `{"queued": True, "job_id": ...}` (by name, plus `tag` and `created`) and no counts; there is no job status endpoint, and the outcome shows as the tag's `member_count` once the job finishes. Applies to `add_tag_contacts`, `remove_tag_contacts`, `tag_contacts`, and `untag_contacts`.
- Survey projects take the three tag fields like broadcast projects; the `create_project` docstring said they refused them.
- The README states the key permission rule: GET needs `public:read`; POST, PATCH, and PUT need `public:write`; DELETE needs `public:write` and `public:delete`.
- `update_project` sends an empty `contact_list_ids`, `suppression_list_ids`, or `media_ids` list instead of dropping it, so `[]` clears the field (`contact_list_ids=[]` is accepted while the project keeps a tag). `None` still leaves a field unchanged.
- `create_email_campaign` no longer needs `list_ids` when `tag_ids` is set.

### Fixed
- Survey projects could not be created: `create_project` required `protocol` and `message_text`, which the API refuses on a survey, and took no `questions`, which it requires. `create_project` and `update_project` now take `questions` (a list of question dicts; on update it replaces the whole set) and `ai_survey_analysis_enabled`. `protocol`, `message_text`, and `phone_number_ids` are now optional parameters, so a survey is `create_project(org_id, name, type="survey", campaign_id=..., phone_number_ids=[...], questions=[...])`; positional broadcast calls work as before. A body that mixes a survey's fields with a message's, a survey without `questions` or `campaign_id`, or a broadcast or triggered project without `protocol` and `message_text` raises `ValueError` before any request.
- `create_email_campaign` documented a sequence step's `send_hour`; the field is `send_time`.

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
