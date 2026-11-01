# Changelog

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
