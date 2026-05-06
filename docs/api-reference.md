# API Reference

Complete inventory of every HTTP route in the application, grouped by surface. For external integration use the public API (`/api/v1`); internal endpoints are documented for contributors.

Auth column key:

- **Bearer**: `Authorization: Bearer <api-key>` (see [api-keys.md](api-keys.md))
- **Session**: NextAuth JWT cookie, set after dashboard login
- **Public**: no auth
- **Webhook**: signed by external provider (Svix or SNS)

---

## Public REST API (`/api/v1`)

External integration surface. Returns `{ data, meta, error }`. See [public-api.md](public-api.md).

| Method | Path | Auth | Source |
| --- | --- | --- | --- |
| GET | `/api/v1/lists` | Bearer | `app/api/v1/lists/route.ts` |
| POST | `/api/v1/lists` | Bearer | `app/api/v1/lists/route.ts` |
| GET | `/api/v1/lists/[listId]/contacts` | Bearer | `app/api/v1/lists/[listId]/contacts/route.ts` |
| POST | `/api/v1/lists/[listId]/contacts` | Bearer | `app/api/v1/lists/[listId]/contacts/route.ts` |
| PUT | `/api/v1/lists/[listId]/contacts/[id]` | Bearer | `app/api/v1/lists/[listId]/contacts/[id]/route.ts` |
| DELETE | `/api/v1/lists/[listId]/contacts/[id]` | Bearer | `app/api/v1/lists/[listId]/contacts/[id]/route.ts` |
| POST | `/api/v1/lists/[listId]/contacts/bulk` | Bearer | `app/api/v1/lists/[listId]/contacts/bulk/route.ts` |
| POST | `/api/v1/email-check` | Bearer | `app/api/v1/email-check/route.ts` |
| GET | `/api/v1/campaigns` | Bearer | `app/api/v1/campaigns/route.ts` |
| GET | `/api/v1/campaigns/[id]` | Bearer | `app/api/v1/campaigns/[id]/route.ts` |
| GET | `/api/v1/campaigns/[id]/stats` | Bearer | `app/api/v1/campaigns/[id]/stats/route.ts` |
| GET | `/api/v1/suppressions` | Bearer | `app/api/v1/suppressions/route.ts` |
| POST | `/api/v1/suppressions` | Bearer | `app/api/v1/suppressions/route.ts` |
| DELETE | `/api/v1/suppressions/[id]` | Bearer | `app/api/v1/suppressions/[id]/route.ts` |
| POST | `/api/v1/suppressions/bulk` | Bearer | `app/api/v1/suppressions/bulk/route.ts` |
| POST | `/api/v1/contacts/[id]/gdpr-delete` | Bearer | `app/api/v1/contacts/[id]/gdpr-delete/route.ts` |
| GET | `/api/v1/contacts/[id]/gdpr-export` | Bearer | `app/api/v1/contacts/[id]/gdpr-export/route.ts` |

All `/api/v1/*` endpoints share per-key rate limiting via `lib/rate-limit/index.ts`. Exceeding the limit returns `429`.

---

## Public form API (`/api/public`)

Used by hosted forms and embedded widgets. No auth.

| Method | Path | Auth | Source |
| --- | --- | --- | --- |
| GET | `/api/public/forms/[id]/schema` | Public | `app/api/public/forms/[id]/schema/route.ts` |
| POST | `/api/public/forms/[id]/submit` | Public | `app/api/public/forms/[id]/submit/route.ts` |
| GET | `/api/public/forms/[id]/embed.js` | Public | `app/api/public/forms/[id]/embed.js/route.ts` |
| POST | `/api/public/accept-invite/[token]` | Public | `app/api/public/accept-invite/[token]/route.ts` |

---

## Webhooks (`/api/webhooks`)

Inbound from email providers. Signature-verified.

| Method | Path | Auth | Source |
| --- | --- | --- | --- |
| POST | `/api/webhooks/resend` | Webhook (Svix) | `app/api/webhooks/resend/route.ts` |
| POST | `/api/webhooks/ses` | Webhook (SNS) | `app/api/webhooks/ses/route.ts` |

See [webhooks.md](webhooks.md).

---

## Tracking and redirects

Embedded in sent emails and form links. No auth.

| Method | Path | Description | Source |
| --- | --- | --- | --- |
| GET | `/t/[sendId]` | Open pixel, returns 1x1 GIF | `app/t/[sendId]/route.ts` |
| GET | `/r/[id]` | Click redirect, decodes payload | `app/r/[id]/route.ts` |
| GET | `/img/[id]` | Stream asset from S3 | `app/img/[id]/route.ts` |
| GET | `/f/[id]` | Short-URL redirect to `/form/[id]` | `app/f/[id]/route.ts` |

---

## Public pages

Routed by Next.js, rendered server-side. No auth.

| Path | Description | Source |
| --- | --- | --- |
| `/login` | Login form | `app/login/page.tsx` |
| `/unsubscribe/[token]` | Unsubscribe page | `app/unsubscribe/[token]/page.tsx` |
| `/confirm/[token]` | Double opt-in confirmation | `app/confirm/[token]/page.tsx` |
| `/form/[id]` | Hosted form | `app/form/[id]/page.tsx` |
| `/accept-invite/[token]` | Team invite acceptance | `app/accept-invite/[token]/page.tsx` |

---

## Internal API (`/api/internal`)

Session-authenticated, used by the dashboard UI. Not part of the public contract; routes can change between releases.

### Lists

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/lists` | `app/api/internal/lists/route.ts` |
| GET, PATCH, DELETE | `/api/internal/lists/[id]` | `app/api/internal/lists/[id]/route.ts` |
| GET | `/api/internal/lists/[id]/contacts` | `app/api/internal/lists/[id]/contacts/route.ts` |
| GET | `/api/internal/lists/[id]/export` | `app/api/internal/lists/[id]/export/route.ts` |
| GET | `/api/internal/lists/[id]/merge-tags` | `app/api/internal/lists/[id]/merge-tags/route.ts` |
| POST | `/api/internal/lists/[id]/upload` | `app/api/internal/lists/[id]/upload/route.ts` |
| POST | `/api/internal/lists/[id]/upload/confirm` | `app/api/internal/lists/[id]/upload/confirm/route.ts` |
| GET | `/api/internal/lists/[id]/duplicates` | `app/api/internal/lists/[id]/duplicates/route.ts` |
| POST | `/api/internal/lists/[id]/duplicates/merge` | `app/api/internal/lists/[id]/duplicates/merge/route.ts` |
| POST | `/api/internal/lists/[id]/email-check` | `app/api/internal/lists/[id]/email-check/route.ts` |
| GET | `/api/internal/duplicates/cross-list` | `app/api/internal/duplicates/cross-list/route.ts` |

### Contacts

| Method | Path | Source |
| --- | --- | --- |
| POST | `/api/internal/contacts/[id]/gdpr-delete` | `app/api/internal/contacts/[id]/gdpr-delete/route.ts` |
| GET | `/api/internal/contacts/[id]/gdpr-export` | `app/api/internal/contacts/[id]/gdpr-export/route.ts` |

### Campaigns

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/campaigns` | `app/api/internal/campaigns/route.ts` |
| GET, PATCH, DELETE | `/api/internal/campaigns/[id]` | `app/api/internal/campaigns/[id]/route.ts` |
| POST | `/api/internal/campaigns/[id]/send` | `app/api/internal/campaigns/[id]/send/route.ts` |
| POST | `/api/internal/campaigns/[id]/cancel` | `app/api/internal/campaigns/[id]/cancel/route.ts` |
| POST | `/api/internal/campaigns/[id]/test-send` | `app/api/internal/campaigns/[id]/test-send/route.ts` |
| POST | `/api/internal/campaigns/[id]/save-as-template` | `app/api/internal/campaigns/[id]/save-as-template/route.ts` |
| GET | `/api/internal/campaigns/[id]/analytics` | `app/api/internal/campaigns/[id]/analytics/route.ts` |

### Templates

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/templates` | `app/api/internal/templates/route.ts` |
| GET, PATCH, DELETE | `/api/internal/templates/[id]` | `app/api/internal/templates/[id]/route.ts` |
| POST | `/api/internal/templates/[id]/use` | `app/api/internal/templates/[id]/use/route.ts` |
| POST | `/api/internal/templates/[id]/test-send` | `app/api/internal/templates/[id]/test-send/route.ts` |

### Forms

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/forms` | `app/api/internal/forms/route.ts` |
| GET, PATCH, DELETE | `/api/internal/forms/[id]` | `app/api/internal/forms/[id]/route.ts` |
| GET | `/api/internal/forms/[id]/submissions` | `app/api/internal/forms/[id]/submissions/route.ts` |

### Assets

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/assets` | `app/api/internal/assets/route.ts` |
| DELETE | `/api/internal/assets/[id]` | `app/api/internal/assets/[id]/route.ts` |
| POST | `/api/internal/images` | `app/api/internal/images/route.ts` |

### Providers

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/providers` | `app/api/internal/providers/route.ts` |
| PATCH, DELETE | `/api/internal/providers/[id]` | `app/api/internal/providers/[id]/route.ts` |
| POST | `/api/internal/providers/[id]/validate` | `app/api/internal/providers/[id]/validate/route.ts` |

### Suppressions

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/suppressions` | `app/api/internal/suppressions/route.ts` |
| DELETE | `/api/internal/suppressions/[id]` | `app/api/internal/suppressions/[id]/route.ts` |
| POST | `/api/internal/suppressions/upload` | `app/api/internal/suppressions/upload/route.ts` |
| POST | `/api/internal/suppressions/upload/confirm` | `app/api/internal/suppressions/upload/confirm/route.ts` |

### Team

| Method | Path | Source |
| --- | --- | --- |
| GET | `/api/internal/team/members` | `app/api/internal/team/members/route.ts` |
| PATCH, DELETE | `/api/internal/team/members/[id]` | `app/api/internal/team/members/[id]/route.ts` |
| GET, POST | `/api/internal/team/invites` | `app/api/internal/team/invites/route.ts` |
| DELETE | `/api/internal/team/invites/[id]` | `app/api/internal/team/invites/[id]/route.ts` |

### API Keys, Settings, Audit Log

| Method | Path | Source |
| --- | --- | --- |
| GET, POST | `/api/internal/api-keys` | `app/api/internal/api-keys/route.ts` |
| DELETE | `/api/internal/api-keys/[id]` | `app/api/internal/api-keys/[id]/route.ts` |
| GET, PATCH | `/api/internal/settings` | `app/api/internal/settings/route.ts` |
| GET | `/api/internal/audit-logs` | `app/api/internal/audit-logs/route.ts` |

---

## Email verification (background worker)

Queued checks use the `verify-contact-email` job in `worker.ts`. Pacing is controlled with environment variables documented in `.env.example` and `lib/email-verify-rate.ts`: minimum gap after each SMTP probe (`EMAIL_VERIFY_MIN_GAP_MS`), worker-side concurrency (`EMAIL_VERIFY_WORKER_CONCURRENCY`), optional staggered scheduling on bulk enqueue and backfill (`EMAIL_VERIFY_ENQUEUE_STAGGER_MS`), plus existing SMTP timeouts and retries.

Startup backfill is enabled by default for unverified contacts and can be disabled with `EMAIL_VERIFY_BACKFILL_ON_START=false`. Use `EMAIL_VERIFY_BACKFILL_MAX` to cap startup enqueue volume.

Manual `POST /api/internal/lists/[id]/email-check` and `POST /api/v1/email-check` invoke the checker in the requesting process and do not use that queue. These checks use the SMTP identity configured in **Settings > Bounces**.

Checker calls are made through the local TypeScript client (`lib/email-checker/checkEmail.ts`) to an external checker API configured via `EMAIL_CHECKER_BASE_URL` (endpoint `/v1/check_email`). `EMAIL_CHECKER_API_SECRET` is required and is sent as `x-api-secret` on checker requests.

Reference checker service implementation: [sagnik11/email-checker](https://github.com/sagnik11/email-checker).

---

## Auth handler

| Method | Path | Auth | Source |
| --- | --- | --- | --- |
| GET, POST | `/api/auth/[...nextauth]` | Public | `app/api/auth/[...nextauth]/route.ts` |

NextAuth v4 dispatcher: handles sign-in, sign-out, session, CSRF, callbacks. See [auth.md](auth.md).
