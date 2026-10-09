# Documentation

Reference documentation for hedwig-mail, the self-hostable broadcast email tool. Each file below covers one feature: what it does, where the code lives, and which routes back it.

## Getting started

Setup, env vars, and deployment live in the top-level `README.md`. These docs assume the app is already running.

## Contacts

- [contact-lists.md](contact-lists.md): named lists with active, bounced, and unsubscribed tabs
- [contact-upload.md](contact-upload.md): CSV and XLSX import with column mapping
- [deduplication.md](deduplication.md): in-list merge and cross-list duplicate view
- [email-checker.md](email-checker.md): verify list addresses and remove invalid ones
- [global-suppression.md](global-suppression.md): project-wide do-not-send list
- [subscription-forms.md](subscription-forms.md): hosted and embeddable signup forms
- [double-opt-in.md](double-opt-in.md): pending status with confirmation link

## Sending

- [email-providers.md](email-providers.md): Resend and AWS SES adapters
- [webhooks.md](webhooks.md): inbound bounce and complaint webhooks
- [templates.md](templates.md): reusable email templates
- [mail-editor.md](mail-editor.md): block editor and raw HTML mode
- [asset-library.md](asset-library.md): uploaded image storage and picker
- [campaigns.md](campaigns.md): campaign lifecycle, scheduling, send rate, cancel

## Engagement

- [tracking.md](tracking.md): open pixel and click redirect
- [analytics.md](analytics.md): per-campaign stats and timeline chart

## Public surfaces

- [unsubscribe.md](unsubscribe.md): public unsubscribe page with custom copy

## Settings and admin

- [general-settings.md](general-settings.md): confirmation sender and unsubscribe page copy
- [api-keys.md](api-keys.md): public API key management
- [team-management.md](team-management.md): users, roles, invites
- [audit-log.md](audit-log.md): immutable log of admin actions
- [gdpr.md](gdpr.md): per-contact hard delete and export
- [auth.md](auth.md): login, sessions, route protection
- [dashboard.md](dashboard.md): home page and sidebar layout

## Developer integration

- [public-api.md](public-api.md): overview of the `/api/v1` surface, auth, rate limits
- [api-reference.md](api-reference.md): canonical reference for every HTTP route in the app

## Operations

- [DELIVERABILITY.md](DELIVERABILITY.md): SPF, DKIM, DMARC, and inbox-placement guidance
