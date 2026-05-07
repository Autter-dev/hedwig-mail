# External Email Checker on Fly.io

Use this when `mail-sending-app` runs on Railway Hobby or any environment where outbound SMTP is restricted.

## Checker app

Reference implementation: [sagnik11/email-checker](https://github.com/sagnik11/email-checker)

Deployed Fly app:

- URL: `https://email-checker-autter.fly.dev`

## Fly deployment steps (checker repo)

```bash
flyctl apps create email-checker-autter --org autter
flyctl secrets set \
  EMAIL_CHECKER__HEADER_SECRET="replace-with-strong-secret" \
  EMAIL_CHECKER__HTTP_HOST="0.0.0.0" \
  EMAIL_CHECKER__HTTP_PORT="8080" \
  EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET="false" \
  --app email-checker-autter
flyctl deploy --app email-checker-autter --remote-only
flyctl scale count 1 --app email-checker-autter --yes
flyctl scale memory 512 --app email-checker-autter
```

No Fly Postgres is required for this API-only checker deployment.

## Configure mail-sending-app (web + worker)

```env
EMAIL_CHECKER_BASE_URL=https://email-checker-autter.fly.dev
EMAIL_CHECKER_API_SECRET=replace-with-strong-secret
EMAIL_CHECKER_TIMEOUT_MS=30000
EMAIL_VERIFY_SMTP_PORT=587
```

SMTP identity still comes from **Settings > Bounces** and is forwarded in checker requests (`from_email`, `hello_name`).

## Verify connectivity

From Railway shell:

```bash
curl -sS "$EMAIL_CHECKER_BASE_URL/health"
curl -X POST "$EMAIL_CHECKER_BASE_URL/v1/check_email" \
  -H "content-type: application/json" \
  -H "x-api-secret: $EMAIL_CHECKER_API_SECRET" \
  -d '{"to_email":"someone@gmail.com"}'
```
