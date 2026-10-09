# Email Checker

## Overview

A dedicated screen for verifying contact addresses and removing the ones that will not deliver. Verification uses syntax, MX, and SMTP checks, and never sends an email. It reuses the same checker and `verify-contact-email` worker job that run after imports.

## User-facing flow

1. Open **Email Checker** in the sidebar, or click **Open Email Checker** on a list's Email Checker tab (links to `/email-checker?listId=<id>`).
2. Pick a list, or keep **All lists**. Summary tiles show checked, valid, invalid, risky, unknown, and not-yet-checked counts.
3. Click **Verify unchecked** to queue contacts that were never checked, or **Re-verify all** to queue every contact again. A progress bar shows while the worker processes the queue. The page polls every 5 seconds, and you can leave and come back.
4. Switch between the **Invalid**, **Risky**, and **Unknown** views. Select rows and click **Remove selected**, or **Remove all** to remove every contact with that verdict in scope.
5. In the confirmation dialog, optionally tick **Also add to the suppression list** so the addresses are blocked if they are imported again.

Removing an address also marks every copy of it in other lists as `undeliverable` (see below), so it stops receiving campaigns from any list.

The **Check one address** tab runs a single on-demand check without touching contacts.

## Verdicts

| Verdict | Meaning | Suggested action |
| --- | --- | --- |
| `invalid` | Domain or mailbox does not exist | Remove |
| `risky` | May accept mail, but has risk signals (catch-all, disposable, full inbox) | Review first |
| `unknown` | Server gave no clear answer | Re-verify later |

## Scope and behavior

- Only contacts with status `active`, `pending`, or `undeliverable` are counted, verified, or removable. Bounced and unsubscribed contacts are never mailed, and the worker skips them.
- Removal is a permanent delete. Send and event history cascades with the contact, same as the per-contact delete on the list page.
- The remove endpoint only deletes contacts whose stored verdict is `invalid`, `risky`, or `unknown`. A valid contact id passed to it is ignored.
- Each list holds its own contact rows, so one address can exist in several lists. When an address is removed, every other copy of it (matched case-insensitively) is kept but set to `undeliverable`, and the removed row's verdict and check time are copied into its metadata. This happens in the same transaction as the delete.
  - Copies that are `bounced` or `unsubscribed` are left as they are, since they are never mailed.
  - A copy whose own check is newer than the removed row's is left alone, so an old result never overwrites a fresh one.
  - Marked copies show up in the Email Checker for their own list. If a later re-verify says the address is deliverable, the worker sets the copy back to `active`.
- Each run marks queued contacts with `_email_verify_queued_at` in metadata. A contact counts as in progress while that timestamp is newer than `_email_verify_checked_at`. Markers older than 24 hours stop counting, so a run lost to a worker outage can be started again.
- One run queues up to 50,000 contacts. Contacts already in progress are skipped, so repeated clicks do not duplicate jobs.
- Throughput follows the worker pacing settings (`EMAIL_VERIFY_MIN_GAP_MS`, `EMAIL_VERIFY_WORKER_CONCURRENCY`). With defaults, expect roughly 1,400 checks per hour per worker.

## API endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/internal/email-check` | Session | Check one address, body `{ email }`. Does not persist. |
| GET | `/api/internal/email-check/summary` | Session | Verdict counts. Query: `listId?` |
| POST | `/api/internal/email-check/verify` | Session | Queue verification, body `{ listId?, scope: 'unchecked' \| 'all' }`. Returns `{ queued, capped }` |
| GET | `/api/internal/email-check/contacts` | Session | Paginated flagged contacts. Query: `listId?`, `verdict` (repeatable), `search`, `page`, `limit` |
| POST | `/api/internal/email-check/remove` | Session | Delete flagged contacts, body `{ listId?, contactIds? \| verdicts?, suppress }`. Returns `{ removed, suppressed, markedElsewhere }` |

Verify and remove actions are recorded in the audit log as `email_check.verify` and `email_check.remove`.

## Key files

- UI: `app/(dashboard)/email-checker/page.tsx`, `components/email-checker/**`
- Logic: `lib/email-verify-cleanup.ts`, `lib/email-verify.ts`
- API: `app/api/internal/email-check/**`
- Worker job: `processVerifyContactEmail` in `worker.ts`
