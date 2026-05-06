# Public REST API

## Overview

A versioned REST API at `/api/v1/*` for managing lists, contacts, suppressions, and reading campaign stats from external systems. Bearer-token auth, JSON envelope, per-key rate limiting.

## Authentication

```
Authorization: Bearer <api-key>
```

Generate keys at `/settings/api-keys`. See [api-keys.md](api-keys.md).

## Response envelope

All responses use:

```ts
{
  "data": T | null,
  "meta": { "page": number, "limit": number, "total": number } | null,
  "error": { "code": string, "message": string, "details"?: any } | null
}
```

- `200`: success, `data` populated
- `400`: validation error (Zod details in `error.details`)
- `401`: missing or invalid bearer token
- `404`: resource not found
- `429`: per-key rate limit exceeded

## Rate limiting

Each API key has its own `rate_limit_per_minute`. The limiter is implemented as a token bucket using a Postgres row-level lock in `lib/rate-limit/index.ts`. When exceeded, the response is `429` with a `Retry-After` header.

## Endpoints

### Lists

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/lists` | List all lists |
| POST | `/api/v1/lists` | Create list |

### Contacts

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/lists/[listId]/contacts` | Paginated contacts. Query: `page`, `limit`, `status`, `search` |
| POST | `/api/v1/lists/[listId]/contacts` | Create one contact |
| PUT | `/api/v1/lists/[listId]/contacts/[id]` | Update contact |
| DELETE | `/api/v1/lists/[listId]/contacts/[id]` | Delete contact |
| POST | `/api/v1/lists/[listId]/contacts/bulk` | Upsert up to 1000 contacts |

### Email verification

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/email-check` | Check one address (body: `{ to_email, check_gravatar? }`). Returns full checker payload plus `verdict` and `undeliverable` (true when verdict is `invalid` or `risky`). |

New contacts from the bulk or single-contact endpoints are queued for background verification. Invalid or risky addresses become list status `undeliverable`.

### Campaigns

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/campaigns` | Read-only list |
| GET | `/api/v1/campaigns/[id]` | Detail |
| GET | `/api/v1/campaigns/[id]/stats` | Engagement stats (see [analytics.md](analytics.md)) |

### Suppressions

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/suppressions` | Paginated list |
| POST | `/api/v1/suppressions` | Add one |
| DELETE | `/api/v1/suppressions/[id]` | Remove |
| POST | `/api/v1/suppressions/bulk` | Bulk add (max 1000) |

### GDPR

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/contacts/[id]/gdpr-delete` | Hard delete with `?confirm=<email>` |
| GET | `/api/v1/contacts/[id]/gdpr-export` | Full export |

## Key files

- Auth: `lib/api-auth.ts`
- Rate limit: `lib/rate-limit/index.ts`
- Routes: `app/api/v1/**`

## Notes

- Campaign creation, sending, scheduling, and editing are intentionally not part of the public API. They live behind the dashboard.
- See [api-reference.md](api-reference.md) for the complete route inventory including internal endpoints.
