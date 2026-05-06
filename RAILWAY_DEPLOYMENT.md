# Railway Deployment Guide (Easy Mode)

This guide deploys the full stack on Railway:

- `web`: Next.js dashboard and API
- `worker`: background email sender (`pg-boss`)
- `postgres`: Railway PostgreSQL plugin
- `minio`: S3-compatible object storage for uploads

Use this guide top-to-bottom once. You will have a working production setup.

## Before You Start

You need:

- A Railway account
- Your GitHub repo connected to Railway
- A domain (optional, you can start with Railway domain)

Generate these now:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Use:

- Base64 output for `NEXTAUTH_SECRET`
- Hex output for `ENCRYPTION_KEY`

## Architecture on Railway

Create one Railway project with 4 services:

1. `web` service from this repo
2. `worker` service from this repo
3. `PostgreSQL` plugin
4. `minio` service from Docker image `minio/minio`

## Step 1: Create Railway Project

1. Create a new project in Railway.
2. Add PostgreSQL plugin.
3. Save the `DATABASE_URL` from PostgreSQL, you will use it in both `web` and `worker`.

## Step 2: Create Web Service

1. Add service from GitHub repo.
2. Railway should auto-detect `Dockerfile`.
3. Keep default start command from image (`node server.js`).
4. Expose the service publicly.
5. Railway gives a public URL, for example `https://your-app.up.railway.app`.

Do not set custom domain yet if you are rushing, you can do that later.

## Step 3: Create Worker Service

1. Add another service from the same GitHub repo.
2. Set start command to:

```bash
node -r tsx/cjs worker-entry.ts
```

3. Do not expose this service publicly.

## Step 4: Create MinIO Service

1. Add service from Docker image: `minio/minio`
2. Set start command:

```bash
server /data --console-address ":9001"
```

3. Add persistent volume mounted to `/data`
4. Set env vars on minio:

```env
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=change-this-password
```

5. Deploy minio service.

## Step 5: Set Environment Variables

Use the copy blocks below exactly.

Replace:

- `<APP_URL>` with your public web URL
- `<DATABASE_URL>` with Railway Postgres URL
- `<NEXTAUTH_SECRET>` with your generated base64 value
- `<ENCRYPTION_KEY>` with your generated 64-char hex value
- `<ADMIN_EMAIL>` and `<ADMIN_PASSWORD>` with your admin login
- `<MINIO_PASSWORD>` with the password you set in minio service
- `<MINIO_INTERNAL_HOST>` with your minio private host in Railway network
- `<CHECKER_PUBLIC_URL>` with your email checker public URL (for example `https://email-checker-production.up.railway.app`)

### 5A) `web` service env vars

```env
APP_URL=<APP_URL>
APP_NAME=hedwig-mail
NEXTAUTH_URL=<APP_URL>
NEXTAUTH_SECRET=<NEXTAUTH_SECRET>

ADMIN_EMAIL=<ADMIN_EMAIL>
ADMIN_PASSWORD=<ADMIN_PASSWORD>

DATABASE_URL=<DATABASE_URL>

S3_ENDPOINT=http://<MINIO_INTERNAL_HOST>:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=<MINIO_PASSWORD>
S3_BUCKET=emailtool
S3_FORCE_PATH_STYLE=true

ENCRYPTION_KEY=<ENCRYPTION_KEY>
WORKER_CONCURRENCY=5
EMAIL_CHECKER_BASE_URL=<CHECKER_PUBLIC_URL>
EMAIL_CHECKER_API_SECRET=<CHECKER_API_SECRET>
# EMAIL_CHECKER_TIMEOUT_MS=30000
# HIBP_API_KEY=<HIBP_API_KEY>
NODE_ENV=production
```

### 5B) `worker` service env vars

Use the exact same values as `web` for:

- `APP_URL`
- `DATABASE_URL`
- all `S3_*` vars
- `ENCRYPTION_KEY`
- any provider webhook or integration vars you use

Copy-paste block:

```env
APP_URL=<APP_URL>
APP_NAME=hedwig-mail
NEXTAUTH_URL=<APP_URL>
NEXTAUTH_SECRET=<NEXTAUTH_SECRET>

ADMIN_EMAIL=<ADMIN_EMAIL>
ADMIN_PASSWORD=<ADMIN_PASSWORD>

DATABASE_URL=<DATABASE_URL>

S3_ENDPOINT=http://<MINIO_INTERNAL_HOST>:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=<MINIO_PASSWORD>
S3_BUCKET=emailtool
S3_FORCE_PATH_STYLE=true

ENCRYPTION_KEY=<ENCRYPTION_KEY>
WORKER_CONCURRENCY=5
EMAIL_CHECKER_BASE_URL=<CHECKER_PUBLIC_URL>
EMAIL_CHECKER_API_SECRET=<CHECKER_API_SECRET>
# EMAIL_CHECKER_TIMEOUT_MS=30000
# HIBP_API_KEY=<HIBP_API_KEY>
NODE_ENV=production
```

### 5C) `minio` service env vars

```env
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=<MINIO_PASSWORD>
```

## Step 6: Migration strategy on Railway

This repo uses a safe startup migration pattern:

- `web` starts via `web-entry.ts`, runs migrations, runs checker `/health` self-check, then starts `server.js`.
- `worker` should start with `worker-entry.ts`, which also runs `lib/db/migrate.ts` before loading `worker.ts`.
- `lib/db/migrate.ts` takes a Postgres advisory lock, so concurrent boots from multiple services do not race.

You can still run migrations manually when needed:

```bash
node -r tsx/cjs lib/db/migrate.ts
```

## Step 7: Create MinIO Bucket

Create bucket named `emailtool`.

Two options:

1. Expose MinIO console temporarily and create bucket in UI.
2. Use `mc` CLI from a temporary container.

Your app expects this bucket to exist.

## Step 8: Redeploy Services

After env vars and migration:

1. Redeploy `web`
2. Redeploy `worker`
3. Check logs for startup errors

## Step 9: Production Verification Checklist

Do this exact smoke test:

1. Open app URL
2. Log in with admin email and password
3. Create a list
4. Upload sample CSV (tests MinIO)
5. Add email provider and validate connection
6. Send a test email
7. Create small campaign and send to a few contacts
8. Confirm worker logs show jobs processed
9. Open email, click link, verify tracking routes work

## Common Mistakes and Fixes

### Login fails

- `NEXTAUTH_URL` must match your real public URL exactly
- `NEXTAUTH_SECRET` must be set on `web`

### Upload fails

- `S3_ENDPOINT` wrong, must point to minio internal hostname and port `9000`
- `S3_BUCKET` missing in minio
- wrong minio credentials

### Campaign stuck in sending

- worker service is not running
- worker has wrong `DATABASE_URL`
- worker missing `ENCRYPTION_KEY` or `S3_*` vars

### Tracking links broken

- `APP_URL` changed after sends
- keep stable production domain in `APP_URL`

## Recommended Next Improvements

After first successful deploy:

1. Add custom domain
2. Set TLS-only provider webhooks
3. Rotate admin default credentials
4. Move MinIO credentials to stronger secrets
5. Add monitoring and alerting on worker logs

## Quick Reference: What Runs Where

- `web`: UI, API routes, tracking routes, auth
- `worker`: queue consumer, sends emails
- `postgres`: app data + pg-boss jobs
- `minio`: uploaded CSV/XLSX storage
