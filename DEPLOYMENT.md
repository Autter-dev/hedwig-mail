# Deployment

This tool ships in two shapes. Pick the one that matches your scale, then follow the matching section.

## Two shapes at a glance

| | Single-server | Distributed |
|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.prod.yml` |
| Postgres | Local container (`db` service) | External (managed RDS, Supabase, etc.) |
| Object storage | Local MinIO (`minio` service) | External (AWS S3, DO Spaces, Wasabi) |
| App + worker | Two containers on one host | Containers can split across hosts |
| When to pick | Up to ~10k emails/day, one VM, fast setup | High availability, separate scaling, managed infra |
| Approx footprint | One 2 GB VM | App tier + worker tier + managed Postgres + S3 |

Both shapes use the same Docker image, so switching is purely a config change.

## Single-server quick start

```bash
cp .env.example .env.local
# Fill in NEXTAUTH_SECRET (openssl rand -base64 32),
# ENCRYPTION_KEY (openssl rand -hex 32), ADMIN_EMAIL, ADMIN_PASSWORD.
docker-compose up -d
npm run db:migrate
```

Then visit `http://localhost:3000` and sign in with your admin credentials. MinIO console is at `http://localhost:9001`.

## Distributed deployment

### External services you provide

- Postgres 16 or newer.
- An S3-compatible bucket (AWS S3, DigitalOcean Spaces, Wasabi, Cloudflare R2).
- A public URL for the app, with TLS in front (load balancer or reverse proxy).

### Required environment variables

Copy `.env.example` to `.env` and fill these in:

| Variable | Purpose |
|---|---|
| `APP_URL` | Public URL the app serves on. Baked into tracking pixels and click links at send time. |
| `APP_NAME` | Display name shown in the unsubscribe page footer. |
| `NEXTAUTH_URL` | Same as `APP_URL`. |
| `NEXTAUTH_SECRET` | JWT signing key. Generate with `openssl rand -base64 32`. |
| `ADMIN_EMAIL` | Login email for the single admin user. |
| `ADMIN_PASSWORD` | Login password. Choose a strong one. |
| `DATABASE_URL` | Postgres connection string. |
| `S3_ENDPOINT` | S3 endpoint. Leave blank for AWS S3, or set to your provider's URL. |
| `S3_REGION` | Bucket region. |
| `S3_ACCESS_KEY_ID` | S3 credentials. |
| `S3_SECRET_ACCESS_KEY` | S3 credentials. |
| `S3_BUCKET` | Bucket name (must already exist). |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO and most non-AWS providers. Remove for AWS S3. |
| `ENCRYPTION_KEY` | 64 hex chars. Encrypts provider credentials at rest. Generate with `openssl rand -hex 32`. |
| `WORKER_CONCURRENCY` | Parallel sends per worker process. Respect your email provider's rate limits. |
| `RESEND_EMAILS_PER_SECOND` | Resend throttle per worker process. Defaults to `2` when unset. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `fatal`. |
| `RESEND_WEBHOOK_SECRET` | Optional. Set if you wire up Resend bounce / complaint webhooks. |
| `POSTHOG_API_KEY` | Optional. Sends app telemetry to PostHog. |
| `POSTHOG_HOST` | Optional. PostHog host, e.g. `https://us.i.posthog.com`. |

### Bring it up

```bash
docker compose -f docker-compose.prod.yml up -d
```

The `migrate` service runs once, applies pending migrations, and exits. The `app` and `worker` services start only after migrations succeed.

### Scaling

Add more workers on the same host:

```bash
docker compose -f docker-compose.prod.yml up -d --scale worker=4
```

The app can run multiple replicas behind a load balancer. Sessions are JWT, so no sticky sessions are needed.

## Splitting onto separate hosts

When one VM is no longer enough, split the prod compose across hosts. Both hosts use the same `.env` (same Postgres, same S3, same secrets):

- **App host**: run only the `app` service.
- **Worker host**: run only the `worker` service. Scale this tier independently of the app tier.
- **Migrate**: run on either host the first time. Re-run only when deploying a new image with new migrations.

Nothing about the codebase requires app and worker to be on the same network or filesystem. They coordinate entirely through Postgres (`pg-boss` queue) and the S3 bucket.

## Smoke test

After deploy, verify the full path works end to end:

1. Sign in at `APP_URL`.
2. Create a list, add a contact (your own email).
3. Connect an email provider in Settings, validate it.
4. Create a campaign, write a message, send a test email to yourself.
5. Confirm in the database: `SELECT status FROM campaign_sends ORDER BY created_at DESC LIMIT 1;` should be `sent`.
6. Open the email and click any link, confirm `campaign_events` records the open and click.

## Operational notes

- **`APP_URL` is sticky.** Tracking pixels and click-redirect links are written into HTML at send time. Changing `APP_URL` after a campaign goes out breaks tracking for that campaign. Pick the final URL before sending real campaigns.
- **Don't rotate `ENCRYPTION_KEY` while provider configs exist.** Stored credentials are encrypted with this key. Rotation makes them unreadable. To rotate, delete and re-add providers after the new key is in place.
- **Respect provider rate limits.** Resend defaults to 10 sends/sec; SES varies by account. Set `WORKER_CONCURRENCY` and `email_providers.rate_limit_per_second` accordingly. Running more workers multiplies effective concurrency.
- **Backups.** Postgres holds everything that matters: lists, contacts, campaigns, send history, encrypted provider configs. Back it up. The S3 bucket holds uploaded CSVs and images; back it up if you care about the originals.
- **Webhooks.** If you wire up Resend or SES bounce / complaint webhooks, point them at `APP_URL/api/webhooks/resend` or `/api/webhooks/ses`. The auth middleware excludes these paths.
