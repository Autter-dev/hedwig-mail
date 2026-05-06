# Setup

This guide walks you from a fresh checkout to a running install, locally or on a server. For deeper operational topics (scaling, distributed deployments, backups), see [DEPLOYMENT.md](./DEPLOYMENT.md). For the full environment variable reference, see the table in [README.md](./README.md#environment-variables).

## Prerequisites

- **Node.js 20+** (only needed for the bare-metal local path)
- **Docker** and **Docker Compose** (for the easy local path and for server deploys)
- **PostgreSQL 16+** (only needed for the bare-metal local path)
- **`openssl`** (for generating secrets)

## Generating secrets

You need two secrets before the app will start. Run these once and keep the output handy:

```bash
# NEXTAUTH_SECRET (JWT signing key)
openssl rand -base64 32

# ENCRYPTION_KEY (encrypts provider credentials at rest)
openssl rand -hex 32
```

Notes:

- `ENCRYPTION_KEY` must be exactly 64 hex characters.
- Do not rotate `ENCRYPTION_KEY` after you have added email providers. The old encrypted credentials become unreadable. If you must rotate, delete and re-add providers afterwards.

## Local setup with Docker Compose (recommended)

This brings up the app, the worker, Postgres, and MinIO together.

```bash
git clone <your-fork-url> hedwig-mail
cd hedwig-mail
cp .env.example .env.local
```

Edit `.env.local`:

- Paste in `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` from the previous step.
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to your login credentials.
- Leave the `S3_*`, `DATABASE_URL`, and `APP_URL` defaults as is.

Bring everything up:

```bash
docker compose up -d
```

Run migrations:

```bash
docker compose exec app node -r tsx/cjs lib/db/migrate.ts
```

Create the MinIO bucket so file uploads work:

1. Open `http://localhost:9001` and sign in with `minioadmin` / `minioadmin`.
2. Create a bucket whose name matches `S3_BUCKET` in `.env.local` (default: `emailtool`).

Sign in to the app at `http://localhost:3000` with the admin credentials you set.

## Local setup without Docker

Use this path if you already have Postgres running locally and prefer to run Node directly.

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` so `DATABASE_URL` points at your local Postgres, and fill in the secrets and admin credentials as above.

Create the database and run migrations:

```bash
createdb emailtool
npm run db:migrate
```

Start the app and the worker in separate terminals:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

The app runs at `http://localhost:3000`.

If you want CSV/XLSX uploads to work, run MinIO too:

```bash
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Then create the bucket at `http://localhost:9001` (same step as the Docker path).

## Verify the install

A quick end-to-end smoke test confirms everything is wired up:

1. Sign in at `http://localhost:3000`.
2. Create a list. Add a contact (use your own email).
3. Go to Settings, Providers. Add a Resend or SES provider and click Validate.
4. Create a campaign, write a short message, then use Send Test Email to send to yourself.
5. Open the email and click any link.
6. Back in the app, the campaign should show one open and one click.

## Deploying to a server

This section covers deploying to a generic Linux VM (DigitalOcean, Hetzner, EC2, your own hardware). For shape options (single-server vs distributed) and scaling guidance, see [DEPLOYMENT.md](./DEPLOYMENT.md).

### Prerequisites

- A Linux VM with Docker and Docker Compose installed.
- A domain pointing at the VM.
- A reverse proxy in front of the app to terminate TLS (Caddy is the easiest, nginx works too).

### Steps

Clone the repo on the server and create the env file:

```bash
git clone <your-fork-url> hedwig-mail
cd hedwig-mail
cp .env.example .env
```

Edit `.env`:

- Set `APP_URL` and `NEXTAUTH_URL` to your public HTTPS URL (e.g. `https://mail.yourdomain.com`).
- Generate fresh `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` values for production.
- Set strong `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- Decide where Postgres and S3 live:
  - **Single server**: keep the defaults and use `docker-compose.yml`. Postgres and MinIO run as containers on the same VM.
  - **Managed Postgres and S3**: point `DATABASE_URL` and the `S3_*` vars at your providers and use `docker-compose.prod.yml` instead.

Bring it up:

```bash
# Single-server shape
docker compose up -d

# Or, with managed Postgres and S3
docker compose -f docker-compose.prod.yml up -d
```

The `migrate` service in `docker-compose.prod.yml` runs migrations once and exits before the app and worker start. For the single-server compose file, run migrations manually:

```bash
docker compose exec app node -r tsx/cjs lib/db/migrate.ts
```

### Reverse proxy

The simplest TLS setup is Caddy. Install Caddy on the VM and add this `Caddyfile`:

```caddy
mail.yourdomain.com {
  reverse_proxy localhost:3000
}
```

Caddy issues and renews TLS certificates automatically. Reload with `caddy reload`.

### Important: APP_URL is sticky

`APP_URL` gets baked into tracking pixels and click-redirect links at send time. Pick the final URL before sending real campaigns. If you change it later, tracking links in already-sent emails break.

### Scaling

Add more worker processes on the same host when send volume grows:

```bash
docker compose -f docker-compose.prod.yml up -d --scale worker=4
```

For splitting app and worker across hosts, see [DEPLOYMENT.md](./DEPLOYMENT.md#splitting-onto-separate-hosts).

## Deploying to Railway

Railway runs the app and worker as separate services backed by a managed Postgres plugin. You still need an external S3-compatible bucket (Railway has no built-in object storage), so create one on AWS S3, Cloudflare R2, or DigitalOcean Spaces first.

### Steps

1. **Create the project.** In Railway, create a new project and pick "Deploy from GitHub repo". Select your fork. Railway auto-detects the Dockerfile and starts a build for the app service.

2. **Add Postgres.** From the project canvas, add a Postgres plugin. Railway provisions it and exposes a `DATABASE_URL` variable on the plugin. In the app service, reference it as `${{ Postgres.DATABASE_URL }}` so it stays in sync.

3. **Set environment variables on the app service:**

   - `APP_URL`: the Railway-provided public URL of the app service (e.g. `https://hedwig-mail-production.up.railway.app`). Update later if you add a custom domain.
   - `NEXTAUTH_URL`: same value as `APP_URL`.
   - `NEXTAUTH_SECRET`: from `openssl rand -base64 32`.
   - `ENCRYPTION_KEY`: from `openssl rand -hex 32`.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`: your login credentials.
   - `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`: point at your external bucket. Set `S3_FORCE_PATH_STYLE=true` for R2/Spaces; remove it for AWS S3.
   - `WORKER_CONCURRENCY`: keep at `5` initially.
   - `DATABASE_URL`: reference variable, see step 2.

4. **Add a worker service.** From the project canvas, "New Service", "GitHub Repo", select the same repo. Open the worker service settings:

   - **Start Command**: `node -r tsx/cjs worker-entry.ts`
   - **Variables**: reference the same Postgres `DATABASE_URL` and copy across `ENCRYPTION_KEY`, `APP_URL`, the `S3_*` vars, and `WORKER_CONCURRENCY`. Use Railway's variable references so updates flow to both services.

5. **Migrations are startup-safe.** The app Docker `CMD` runs migrations before boot, and `worker-entry.ts` does the same for the worker. Migration execution uses a Postgres advisory lock, so concurrent deploys from app and worker cannot race.

6. **Optional manual migration.** Easiest path: from your local machine with the Railway CLI:

   ```bash
   npm install -g @railway/cli
   railway login
   railway link    # pick the project
   railway run npm run db:migrate
   ```

   The CLI runs the command locally with Railway's env vars injected, including the production `DATABASE_URL`.

7. **Custom domain (optional).** In the app service settings, add a custom domain. Once the DNS record is verified, update `APP_URL` and `NEXTAUTH_URL` to the new domain. Do this before sending real campaigns, since `APP_URL` is baked into sent email links.

8. **Sign in** at your `APP_URL` with the admin credentials you set.

## Email deliverability

Self-hosting the sender does not change the rules of email. Inboxes still judge mail by the sending domain's reputation. Skip these steps and your campaigns land in spam.

### Authenticate your domain

Before sending real campaigns, set up all three at your DNS provider:

- **SPF**: a TXT record on the sending domain that lists which servers may send on its behalf. Resend and SES both publish the exact record in their dashboards.
- **DKIM**: a public key the provider uses to sign outgoing mail. Resend and SES generate the CNAME or TXT records for you when you verify a domain.
- **DMARC**: a TXT record at `_dmarc.yourdomain.com` that tells inboxes what to do when SPF or DKIM fail. A sensible starter policy:

  ```
  v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
  ```

  Start with `p=none` so you get reports without breaking delivery, then tighten to `quarantine` or `reject` once you trust the setup.

### Use a subdomain for marketing mail

Send broadcasts from a subdomain like `mail.yourdomain.com`, never from your primary domain. If a campaign tanks the subdomain's reputation, your transactional mail and personal email keep flowing.

### Warm up new sending domains

A brand-new domain that suddenly ships 50,000 emails looks exactly like a spammer. Ramp slowly: a few hundred sends per day for the first week, then double daily until you reach steady volume. Both Resend and SES publish warm-up guides for their platforms.

### Keep your lists clean

The app already moves bounced and unsubscribed contacts out of the active set. Wire up the bounce and complaint webhooks (see [README.md](./README.md#setting-up-webhooks)) so this happens automatically. Sending to addresses that bounce is the fastest way to wreck a domain's reputation.

## Updating to a new version

Pull the latest code, rebuild, and re-run migrations:

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

For the production compose file, the `migrate` service applies pending migrations automatically on startup. For the single-server compose file, run them manually:

```bash
docker compose exec app node -r tsx/cjs lib/db/migrate.ts
```

For the bare-metal Node setup, replace the build step with `npm install && npm run build`.

## Backups

Everything that matters lives in Postgres: lists, contacts, campaigns, send history, encrypted provider configs, and API keys. Back it up.

A simple nightly dump of a containerized Postgres:

```bash
docker compose exec -T db pg_dump -U postgres emailtool | gzip > "backup-$(date +%F).sql.gz"
```

If you use managed Postgres (Railway, RDS, Supabase, Neon), enable automatic backups in their dashboard.

The S3 bucket holds uploaded CSVs and image assets. Back it up too if you want to recover the originals; the app does not need them after import.

To restore:

```bash
gunzip -c backup-2026-05-02.sql.gz | docker compose exec -T db psql -U postgres emailtool
```

## Production security checklist

Before you point the app at the open internet, confirm each of these:

- [ ] `APP_URL` and `NEXTAUTH_URL` use HTTPS, with TLS handled by a reverse proxy (Caddy, nginx, or your platform's load balancer).
- [ ] `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` are unique to this deployment, not copied from `.env.example`.
- [ ] `ADMIN_PASSWORD` is long and random, not a value from a password list.
- [ ] `.env` and `.env.local` are not committed to git (`.gitignore` already covers them; double-check your fork).
- [ ] Postgres is not reachable from the public internet. Bind it to `localhost` or a private network.
- [ ] The S3 bucket is private. Uploaded CSVs may contain personal data; presigned URLs handle access.
- [ ] DNS records (SPF, DKIM, DMARC) are in place for your sending domain.
- [ ] Bounce and complaint webhooks are wired up so unsubscribes and bounces flow back automatically.
- [ ] Postgres has automatic backups enabled.
- [ ] You have tested a restore from a backup at least once.

## Troubleshooting

### Cannot connect to the database

If the app or worker logs show `ECONNREFUSED` or `database "emailtool" does not exist`:

- Confirm Postgres is running: `docker compose ps db` or `pg_isready` for bare metal.
- Confirm `DATABASE_URL` matches what Postgres is actually serving (host, port, user, password, db name).
- For Docker, the host should be the service name (`db`), not `localhost`. From inside a container, `localhost` points to the container itself.

### Cannot sign in

- The login form rejects anything that does not exactly match `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Check for trailing whitespace in `.env`.
- If the page redirect loops, `NEXTAUTH_URL` does not match the URL you opened in the browser. They must match exactly, including protocol and port.

### Worker is running but jobs do not process

- The worker connects to the same Postgres as the app. Confirm both services see the same `DATABASE_URL`.
- Look for `pg-boss` errors in the worker log. The first start creates the `pgboss` schema; the database user needs CREATE privileges.
- If the campaign was already cancelled, the worker fails its sends with `Cancelled`. Send a fresh test campaign.

### Test email sends but real campaigns fail

- Check the per-send error in the database: `SELECT contact_id, error_message FROM campaign_sends WHERE status = 'failed' LIMIT 10;`
- Most common causes: provider rate limit exceeded, sending domain not verified, recipient already marked as bounced.

### File uploads fail with `NoSuchBucket`

The S3 bucket must exist before the first upload. Create it via the MinIO console at `http://localhost:9001` or the AWS S3 console, with the same name as `S3_BUCKET`.

### Tracking links go to a 404

`APP_URL` was changed after the campaign was sent. The old URL is baked into those emails and there is no way to retroactively rewrite them. Set `APP_URL` to the final value before sending real campaigns.

## Getting help and contributing

- **Bugs and feature requests**: open an issue on GitHub. Include the version (commit hash), deployment shape, and relevant logs.
- **Pull requests**: see [CONTRIBUTING.md](./CONTRIBUTING.md) for branch naming, the PR checklist, and local development tips.
- **Operational questions**: read [DEPLOYMENT.md](./DEPLOYMENT.md) first, then open a discussion on GitHub.
- **Security issues**: do not file a public issue. See [SECURITY.md](./SECURITY.md) for the private reporting process.

## Common gotchas

- **`APP_URL` is baked into emails at send time.** Pick the final URL before sending real campaigns. Changing it later breaks tracking pixels and click links in emails already sent.
- **Do not rotate `ENCRYPTION_KEY` while provider configs exist.** Stored credentials become unreadable. Rotate by deleting and re-adding providers.
- **Respect provider rate limits.** Resend defaults to 10 sends/sec, SES varies by account. Tune `WORKER_CONCURRENCY` and the per-provider `rate_limit_per_second` so combined concurrency stays under your limit.
- **Webhooks need a public URL.** If you wire up Resend or SES bounce/complaint webhooks, point them at `APP_URL/api/webhooks/resend` or `APP_URL/api/webhooks/ses`. The auth middleware excludes those paths.
- **Back up Postgres.** It holds lists, contacts, campaigns, send history, and the encrypted provider configs. Everything that matters lives there.
