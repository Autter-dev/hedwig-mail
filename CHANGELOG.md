# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased

### Added

- Project scaffold with Next.js 14, Drizzle ORM, pg-boss, and Tailwind CSS
- Contact list management with CSV/XLSX import and column mapping
- Email provider integration (Resend and Amazon SES) with encrypted credential storage
- Visual block email editor with drag-and-drop, live preview, and merge tags
- Asset library for centrally managing uploaded images and files, with reuse across campaigns via the editor's "Choose from library" picker
- Saved templates library with iframe thumbnail previews. Save campaigns as reusable templates, edit template content in place, start new campaigns prefilled from any template
- Campaign creation, sending, scheduling, and cancellation
- Open tracking (pixel) and click tracking (link wrapping) with per-campaign analytics
- Unsubscribe page with one-click opt-out and List-Unsubscribe header support
- Per-list double opt-in: toggle on a list to require new contacts to confirm via emailed link before they can be sent campaigns. Pending contacts are excluded from sends until confirmed. Configurable via `CONFIRMATION_FROM_EMAIL` env var and a switch on the list detail page.
- Public REST API with Bearer token authentication
- API key management in the dashboard
- Webhook receivers for Resend and SES bounce/complaint notifications
- Dashboard with summary stats and recent campaigns
- Docker Compose setup for local development (Postgres, MinIO, app, worker)
- Production Dockerfile with standalone Next.js output
- Email Checker screen: verify any list (or all lists) in the background, review invalid, risky, and unknown addresses, and bulk remove them with optional suppression. Removing an address marks its copies in other lists as undeliverable
- Embeddable signup forms with builder UI, hosted form pages at `/form/:id`, and a drop-in JS embed snippet
- Optional double opt-in flow with `pending` contact status, confirmation token, transactional confirmation email job, and a confirmation page at `/confirm/:token`
