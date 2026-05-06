# Contact Lists

## Overview

Named lists hold contacts and own the relationship to campaigns. Each list can optionally require double opt-in for new sign-ups.

## User-facing flow

1. Visit `/lists` to see all lists with contact counts (active, bounced, unsubscribed).
2. Click "New List" to create one with a name and description.
3. Click a list to view its contacts, paginated and tabbed by status.
4. Use the search box to filter contacts by email.
5. Export to CSV from the list detail page.

## Routes & pages

- `/lists`: index with counts
- `/lists/[id]`: contact tabs (active, bounced, undeliverable, unsubscribed, pending), plus Duplicates and Email Checker
- `/lists/[id]/upload`: import flow (see [contact-upload.md](contact-upload.md))
- `/lists/duplicates`: cross-list duplicates view (see [deduplication.md](deduplication.md))

## API endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/internal/lists` | Session | List all lists with counts |
| POST | `/api/internal/lists` | Session | Create list, body `{ name, description?, requireDoubleOptIn? }` |
| GET | `/api/internal/lists/[id]` | Session | Get list with counts |
| PATCH | `/api/internal/lists/[id]` | Session | Update list |
| DELETE | `/api/internal/lists/[id]` | Session | Delete list (cascades contacts) |
| GET | `/api/internal/lists/[id]/contacts` | Session | Paginated contacts. Query: `page`, `limit`, `status`, `search` |
| POST | `/api/internal/lists/[id]/email-check` | Session | Manual SMTP check for one email (body: `{ email }`). Does not persist. |
| GET | `/api/internal/lists/[id]/export` | Session | Stream CSV of all contacts |
| GET | `/api/internal/lists/[id]/merge-tags` | Session | Discover available metadata keys |

Public REST equivalents under `/api/v1/lists` are documented in [public-api.md](public-api.md).

## Key files

- UI: `app/(dashboard)/lists/page.tsx`, `app/(dashboard)/lists/[id]/page.tsx`
- API: `app/api/internal/lists/**`
- Schema: `lib/db/schema.ts` (`lists`, `contacts`)

## Database

- `lists`: id, name, description, require_double_opt_in, timestamps
- `contacts`: id, list_id, email, first_name, last_name, metadata jsonb, status, unsubscribe_token, confirmation_token, timestamps. Unique on `(list_id, email)`.

## Notes

- Contact `status` values: `active`, `bounced`, `undeliverable`, `unsubscribed`, `pending`. Imports enqueue verification: `invalid` or `risky` SMTP verdicts map to `undeliverable`.
- `pending` is set when double opt-in is required and the contact has not confirmed yet.
- Deleting a list cascades to its contacts and their send and event history.
