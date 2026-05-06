import { and, inArray, or, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { db } from '@/lib/db'
import { contacts } from '@/lib/db/schema'
import { JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'

const CHUNK = 200

/**
 * Enqueues VERIFY_CONTACT_EMAIL for contacts that have never been scanned
 * (no _email_verify_checked_at in metadata). Gated by EMAIL_VERIFY_BACKFILL_ON_START.
 * Intended for Railway worker deploy so existing lists are verified without a manual job.
 */
export async function runEmailVerifyBackfillOnWorkerStart(boss: PgBoss): Promise<number> {
  const flag = process.env.EMAIL_VERIFY_BACKFILL_ON_START
  if (flag !== 'true' && flag !== '1') {
    return 0
  }

  const maxRaw = parseInt(process.env.EMAIL_VERIFY_BACKFILL_MAX || '50000', 10)
  const max = Math.min(Math.max(1, Number.isFinite(maxRaw) ? maxRaw : 50000), 500_000)

  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        inArray(contacts.status, ['active', 'pending', 'undeliverable']),
        or(
          sql`${contacts.metadata} is null`,
          sql`(${contacts.metadata}->>'_email_verify_checked_at') is null`,
          sql`trim(both from coalesce(${contacts.metadata}->>'_email_verify_checked_at', '')) = ''`,
        ),
      ),
    )
    .limit(max)

  const ids = rows.map((r) => r.id)
  if (ids.length === 0) {
    logger.info('Email verify backfill: no unscanned contacts found')
    return 0
  }

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    await Promise.all(slice.map((contactId) => boss.send(JOBS.VERIFY_CONTACT_EMAIL, { contactId })))
  }

  logger.info({ enqueued: ids.length, max }, 'Email verify backfill enqueued (worker startup)')
  return ids.length
}
