# Changelog

## [0.23.0] - 2026-11-17

### Added
- `tags list`, `tags create` (`--name`, or `--activity donated|clicked|responded|sent` with optional `--within-days`), `tags rename <id> --name`, `tags delete <id>`, `tags add <id>`, and `tags remove <id>` (`--identifier`, repeatable, or one `--contact-list-id`). `tags delete` and `tags remove` need an API key with the `public:delete` permission.
- `tags add --name <name>` and `tags remove --name <name>` address a tag by name instead of id, with optional `--organization-id`. `tags add --name` creates the tag when the organization has none by that name (ignoring case) and prints `Created tag` or `Used existing tag` with its id; `tags remove --name` never creates one.
- `contact-lists get` prints `Import failed: <message> (<code>)` and `Email import failed: ...` when a side of the list's import failed.
- `projects create` takes `--tag-id` (send to contacts carrying ANY of these tags, in union with the lists), `--require-tag-id` (keep only contacts carrying ALL of them), and `--suppression-tag-id`, each repeatable. `--contact-list-id` is no longer required when `--tag-id` is given.
- `tags add` takes `--fire-triggers` or `--no-fire-triggers`: whether newly tagged contacts enter the tag's live triggers, which messages them (the API default is on for `--identifier`, off for `--contact-list-id`); the output says how many entered. `tags remove` refuses both flags. There is no import command, so no import path takes them.
- `tags list` shows a LIVE TRIGGERS column: the started triggered projects and campaigns listening for each tag.
- `projects start <id> --audience current_and_new|new_only`, required for a tag trigger's first start.
- `projects create` takes follow-ups: `--follow-up <N>d=<text>` or `<N>h=<text>` (repeatable, in order), `--stop-on-reply` and/or `--stop-on-click` (at least one with `--follow-up`), and `--send-time HH:MM` with `--timezone` for day waits. Text only; follow-up media goes through the SDK.

### Fixed
- `projects create` printed an empty id; it now prints the new project's `project_id`.

### Changed
- Requires `@political-comms/sdk` ^0.24.0.
- Behavior change: `tags add` and `tags remove` with `--contact-list-id` print `Tagging queued (job <id>)` or `Untagging queued (job <id>)` and that the tag's member count in `tags list` updates when it finishes, instead of counts. Tagging or untagging by `contact_list_id` is queued, a change made the same day this release was prepared: the API answers 202 with `{ queued: true, job_id }` (by name, plus `tag` and `created`) and no counts; there is no job status endpoint, and the outcome shows as the tag's `member_count` once the job finishes.
- `contact-lists delete` and `media delete` need an API key with the `public:delete` permission (and `public:write`); other keys get a 403.

## [0.22.0] - 2026-11-13

### Added
- `webhooks endpoints list` (`--limit`, `--cursor`) and `webhooks endpoints get <id>` show webhook endpoints and their delivery health. Read-only.

### Changed
- Requires `@political-comms/sdk` ^0.22.0.

## [0.21.0] - 2026-11-13

### Changed
- Requires `@political-comms/sdk` ^0.21.0. No new commands: the email surface stays read-only.

## [0.20.0] - 2026-11-12

### Added
- `projects start <id>` starts or resumes a triggered project and `projects end <id>` ends it for good.

### Changed
- Requires `@political-comms/sdk` ^0.20.0.

## [0.19.0] - 2026-11-10

### Breaking
- Breaking: `email lists list` is removed, because `GET /email/lists` no longer exists. Use `contact-lists list --channel email` (or `--channel all`).

### Added
- `contact-lists list` accepts `--channel text|email|all` (default `text`) and shows each list's channels.

### Fixed
- `contact-lists list` shows the list name and created date; it read fields the API does not return, so the name column was blank.
- `email drafts` and `email imports` are no longer accepted as subcommands; they had no command behind them.

### Changed
- Requires `@political-comms/sdk` 0.19.

## [0.18.0] - 2026-10-31

### Added
- `projects survey-results <id>` prints a survey's topline results: the project line, then each question with its option counts and percentages and the "other" bucket. `--json` prints the raw response.
- `projects stats <id>` shows delivery and engagement stats for one project.
- `conversations reply` accepts `--media-id` to send an MMS reply, and `--text` is optional when a media id is given.

### Changed
- `projects throughput` help describes recipients per carrier and how long AT&T takes.
- `--daily-cap-bypass` output explains that T-Mobile recipients send at full speed past the daily limit and that a carrier rejection still pauses the project.

## [0.17.0] - 2026-10-10

### Changed
- Updated to SDK 0.17.0 (editing paused projects and changing a project's sending setup).

## [0.16.0] - 2026-10-07

Previously published baseline: `projects pause <id>`.
