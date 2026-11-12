# Changelog

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
