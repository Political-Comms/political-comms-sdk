# @political-comms/cli

Command line interface for the [Political Comms](https://politicalcomms.com/) REST API.

## Usage

No install required:

```bash
export POLITICAL_COMMS_API_KEY=pc_live_...
npx @political-comms/cli auth check
```

Or install globally:

```bash
npm install -g @political-comms/cli
political-comms auth check
```

## Commands

```
auth check                       Verify the API key by listing organizations
orgs list                        List organizations visible to the key
hierarchy                        Show the organization hierarchy
projects list                    List projects
projects get <id>                Show one project
projects stats <id>              Show delivery and engagement stats
projects survey-results <id>     Show survey results (survey projects only)
projects create                  Create a project
projects test <id>               Send a test message (--phone, repeatable)
projects schedule <id>           Schedule a send (--send-at, --timezone)
projects unschedule <id>         Remove a schedule
projects pause <id>              Pause a running or scheduled send ([--reason])
projects start <id>              Start or resume a triggered project
projects end <id>                End a triggered project (final)
projects copy <id>               Copy a project (drops lists, schedule, stats)
contact-lists list               List contact lists (--channel text|email|all;
                                 default text)
contact-lists get <id>           Show one contact list
contact-lists download <id>      Print a contact list CSV (--type original|analyzed)
contact-lists delete <id>        Delete an unused contact list (phones and emails)
conversations list               List conversations with an inbound message
                                  (--project, --since, --include-test)
conversations get <id>           Show one conversation
conversations messages <id>      List messages in a conversation
conversations reply <id>         Send a real reply (--text and/or --media-id, one required)
media list                       List media files
media get <id>                   Show one media file
media delete <id>                Delete an unused media file
stats messages                   Message stats (--from, --to; default last 30 days)
usage                            Billing usage (--from, --to; default last 30 days)
webhooks endpoints list          List webhook endpoints (--limit, --cursor)
webhooks endpoints get <id>      Show one webhook endpoint
email domains list               List email sending domains
email senders list               List email sender identities
email suppressions list          List email suppressions (--scope)
email campaigns list             List email campaigns (--status)
email campaigns get <id>         Show one email campaign, including blockers
email campaigns stats <id>       Show email campaign report tiles
email templates list             List email templates (--search)
email templates get <id>         Show one email template (HTML only with --json)
```

The `email` commands are read-only by design.
The rest of the write side of the email API (importing a CSV, scheduling campaigns,
saving templates) is multi-step and belongs in a script against the SDK rather
than in flag-per-field shell invocations. Paid and human-driven workflows
(AI drafting, result exports) run in the dashboard.

Template HTML is printed only with `--json`. Without it the commands report the
body size, so a multi-megabyte email never floods the terminal.

### Examples

```bash
# Verify credentials
npx @political-comms/cli auth check

# Create a project
npx @political-comms/cli projects create \
  --name "GOTV reminder" \
  --organization-id org_123 \
  --brand-id brand_123 \
  --campaign-id camp_123 \
  --protocol sms \
  --phone-number-id pn_123 \
  --contact-list-id cl_123 \
  --body "Polls are open until 8pm."

# Send a test to yourself
npx @political-comms/cli projects test proj_123 --phone +15555550100

# Schedule the send
npx @political-comms/cli projects schedule proj_123 \
  --send-at 2026-11-03T09:00:00 --timezone America/New_York

# Same, but skip the reduced rate past the brand's daily T-Mobile carrier limit
# and send T-Mobile recipients at full speed (a carrier rejection still pauses
# the project, and rejected messages are still billed)
npx @political-comms/cli projects schedule proj_123 \
  --send-at 2026-11-03T09:00:00 --timezone America/New_York --daily-cap-bypass

# Rehearse a failure without texting a real phone: a test phone number
# (555-0100 through 555-0199 in any area code) never reaches a carrier
npx @political-comms/cli projects test proj_123 --phone +12025550101

# Message stats for June
npx @political-comms/cli stats messages --from 2026-06-01 --to 2026-06-30 --json

# Recover inbound messages missed while a webhook endpoint was down
npx @political-comms/cli conversations list --since 2026-09-01T00:00:00Z

# Reply to a conversation (sends a real SMS, or an MMS with --media-id)
npx @political-comms/cli conversations reply conv_123 --text "Thanks for reaching out!"
npx @political-comms/cli conversations reply conv_123 --media-id <media id> --text "Here is the flyer"
```

## Global options

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key. Defaults to the `POLITICAL_COMMS_API_KEY` environment variable. |
| `--json` | Print the raw JSON response instead of formatted text. |
| `-h, --help` | Show help. |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error (the code and message are printed, with a link to the error reference) |
| 2 | Usage error (help is printed) |

Error codes are documented at [politicalcomms.com/errors.md](https://politicalcomms.com/errors.md). Full API reference: [docs.politicalcomms.com](https://docs.politicalcomms.com/api-reference/introduction).

## License

MIT. Questions: support@politicalcomms.com
