import { and, asc, eq, ilike, inArray, not, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contacts, lists, suppressions } from '@/lib/db/schema'
import { enqueueVerifyJobs } from '@/lib/email-verify'
import { normalizeEmail } from '@/lib/suppressions'
import type { EmailCheckFlaggedVerdict } from '@/lib/validations/email-check'

/**
 * Backs the Email Checker screen: per-list verification summary, on-demand
 * verification runs, and bulk removal of addresses the checker flagged.
 *
 * Verification results live in contact metadata, written by the worker:
 *   _email_verify_reachable   safe | risky | invalid | unknown
 *   _email_verify_checked_at  ISO timestamp of the last probe
 * This module adds one more key:
 *   _email_verify_queued_at   ISO timestamp of the last on-demand run request
 * A contact is "in progress" when it was queued after its last check.
 */

// Bounced and unsubscribed contacts are never mailed and the worker skips them.
export const CHECKABLE_STATUSES = ['active', 'pending', 'undeliverable']

export const FLAGGED_VERDICTS: EmailCheckFlaggedVerdict[] = ['invalid', 'risky', 'unknown']

// Queued runs that never produced a result (failed jobs, worker down) stop
// counting as in progress after this window, so they can be re-queued.
const IN_PROGRESS_WINDOW = sql`interval '24 hours'`

const MAX_PER_RUN = 50_000
const UPDATE_CHUNK = 1000
const SUPPRESS_CHUNK = 500

const verdictExpr = sql<string | null>`nullif(${contacts.metadata}->>'_email_verify_reachable', '')`
const checkedAtExpr = sql`nullif(trim(both from coalesce(${contacts.metadata}->>'_email_verify_checked_at', '')), '')::timestamptz`
const queuedAtExpr = sql`nullif(${contacts.metadata}->>'_email_verify_queued_at', '')::timestamptz`
// coalesce keeps this strictly true or false: a NULL here would make not(inProgressCond) drop never-queued rows.
const inProgressCond = sql`coalesce(${queuedAtExpr} > now() - ${IN_PROGRESS_WINDOW} and (${checkedAtExpr} is null or ${queuedAtExpr} > ${checkedAtExpr}), false)`

function scopeWhere(listId: string | undefined, ...extra: (SQL | undefined)[]): SQL | undefined {
  return and(
    inArray(contacts.status, CHECKABLE_STATUSES),
    listId ? eq(contacts.listId, listId) : undefined,
    ...extra,
  )
}

export interface EmailCheckSummary {
  total: number
  safe: number
  risky: number
  invalid: number
  unknown: number
  unchecked: number
  inProgress: number
  // Unchecked contacts not already queued: what "verify unchecked" would pick up.
  uncheckedIdle: number
}

export async function getEmailCheckSummary(listId?: string): Promise<EmailCheckSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      safe: sql<number>`(count(*) filter (where ${verdictExpr} = 'safe'))::int`,
      risky: sql<number>`(count(*) filter (where ${verdictExpr} = 'risky'))::int`,
      invalid: sql<number>`(count(*) filter (where ${verdictExpr} = 'invalid'))::int`,
      unknown: sql<number>`(count(*) filter (where ${verdictExpr} = 'unknown'))::int`,
      unchecked: sql<number>`(count(*) filter (where ${checkedAtExpr} is null))::int`,
      inProgress: sql<number>`(count(*) filter (where ${inProgressCond}))::int`,
      uncheckedIdle: sql<number>`(count(*) filter (where ${checkedAtExpr} is null and not ${inProgressCond}))::int`,
    })
    .from(contacts)
    .where(scopeWhere(listId))

  return row ?? { total: 0, safe: 0, risky: 0, invalid: 0, unknown: 0, unchecked: 0, inProgress: 0, uncheckedIdle: 0 }
}

/**
 * Queues verification for contacts in scope. Contacts already in progress are
 * skipped, so pressing the button twice does not double the work.
 */
export async function startEmailCheckRun(
  listId: string | undefined,
  scope: 'unchecked' | 'all',
): Promise<{ queued: number; capped: boolean }> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      scopeWhere(
        listId,
        not(inProgressCond),
        scope === 'unchecked' ? sql`${checkedAtExpr} is null` : undefined,
      ),
    )
    .limit(MAX_PER_RUN + 1)

  const capped = rows.length > MAX_PER_RUN
  const ids = rows.slice(0, MAX_PER_RUN).map((r) => r.id)
  if (ids.length === 0) return { queued: 0, capped: false }

  const queuedAt = new Date().toISOString()
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    await db
      .update(contacts)
      .set({
        metadata: sql`coalesce(${contacts.metadata}, '{}'::jsonb) || jsonb_build_object('_email_verify_queued_at', ${queuedAt}::text)`,
      })
      .where(inArray(contacts.id, ids.slice(i, i + UPDATE_CHUNK)))
  }

  try {
    await enqueueVerifyJobs(ids)
  } catch (err) {
    // Clear the markers so the UI does not show a run that will never finish.
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      await db
        .update(contacts)
        .set({ metadata: sql`${contacts.metadata} - '_email_verify_queued_at'` })
        .where(inArray(contacts.id, ids.slice(i, i + UPDATE_CHUNK)))
    }
    throw err
  }

  return { queued: ids.length, capped }
}

export interface FlaggedContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: string
  listId: string
  listName: string | null
  verdict: string
  checkedAt: string | null
  smtpError: string | null
}

export async function listFlaggedContacts(options: {
  listId?: string
  verdicts: EmailCheckFlaggedVerdict[]
  search?: string
  page: number
  limit: number
}): Promise<{ data: FlaggedContact[]; total: number }> {
  const { listId, verdicts, search, page, limit } = options
  const where = scopeWhere(
    listId,
    inArray(verdictExpr, verdicts),
    search ? ilike(contacts.email, `%${search}%`) : undefined,
  )

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contacts)
    .where(where)

  const rows = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      status: contacts.status,
      listId: contacts.listId,
      listName: lists.name,
      verdict: sql<string>`${verdictExpr}`,
      checkedAt: sql<string | null>`${contacts.metadata}->>'_email_verify_checked_at'`,
      smtpError: sql<string | null>`${contacts.metadata}->>'_email_verify_smtp_error'`,
    })
    .from(contacts)
    .leftJoin(lists, eq(contacts.listId, lists.id))
    .where(where)
    .orderBy(asc(contacts.email))
    .limit(limit)
    .offset((page - 1) * limit)

  return { data: rows, total }
}

export interface RemoveFlaggedResult {
  removed: { id: string; email: string; listId: string; verdict: string | null; checkedAt: string | null }[]
  suppressed: number
  // Copies of the removed addresses in other lists that were set to undeliverable.
  markedElsewhere: number
}

/**
 * Permanently deletes flagged contacts. Only contacts whose stored verdict is
 * one of the flagged verdicts can be removed here, so this never doubles as a
 * general purpose delete. Send and event history cascade with the contact.
 *
 * The same address in any other list is kept but set to undeliverable, with the
 * removed row's verdict copied over, so it stops receiving campaigns everywhere.
 */
export async function removeFlaggedContacts(options: {
  listId?: string
  contactIds?: string[]
  verdicts?: EmailCheckFlaggedVerdict[]
  suppress: boolean
}): Promise<RemoveFlaggedResult> {
  const { listId, contactIds, suppress } = options
  const verdicts = options.verdicts ?? FLAGGED_VERDICTS

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(contacts)
      .where(
        scopeWhere(
          listId,
          inArray(verdictExpr, verdicts),
          contactIds ? inArray(contacts.id, contactIds) : undefined,
        ),
      )
      .returning({
        id: contacts.id,
        email: contacts.email,
        listId: contacts.listId,
        verdict: sql<string | null>`${verdictExpr}`,
        checkedAt: sql<string | null>`nullif(trim(both from coalesce(${contacts.metadata}->>'_email_verify_checked_at', '')), '')`,
      })

    const markedElsewhere = await markCopiesUndeliverable(tx, removed)

    let suppressed = 0
    if (suppress && removed.length > 0) {
      const seen = new Set<string>()
      const values: (typeof suppressions.$inferInsert)[] = []
      for (const r of removed) {
        const email = normalizeEmail(r.email)
        if (!email || seen.has(email)) continue
        seen.add(email)
        values.push({
          email,
          reason: 'manual',
          source: 'email-checker',
          metadata: { verdict: r.verdict },
        })
      }
      for (let i = 0; i < values.length; i += SUPPRESS_CHUNK) {
        const inserted = await tx
          .insert(suppressions)
          .values(values.slice(i, i + SUPPRESS_CHUNK))
          .onConflictDoNothing({ target: suppressions.email })
          .returning({ id: suppressions.id })
        suppressed += inserted.length
      }
    }

    return { removed, suppressed, markedElsewhere }
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Sets every remaining copy of the removed addresses (matched case-insensitively,
 * across all lists) to undeliverable and copies the verdict onto it. Bounced and
 * unsubscribed copies are left alone. A copy whose own check is newer than the
 * removed row's is also left alone, so an old result never overwrites a fresh one.
 */
async function markCopiesUndeliverable(tx: Tx, removed: RemoveFlaggedResult['removed']): Promise<number> {
  // One entry per address. If the same address was removed from several lists, use the latest check.
  const byEmail = new Map<string, { verdict: string; checkedAt: string }>()
  const fallbackCheckedAt = new Date().toISOString()
  for (const r of removed) {
    const email = normalizeEmail(r.email)
    if (!email || !r.verdict) continue
    const checkedAt = r.checkedAt ?? fallbackCheckedAt
    const prev = byEmail.get(email)
    if (!prev || Date.parse(checkedAt) > Date.parse(prev.checkedAt)) {
      byEmail.set(email, { verdict: r.verdict, checkedAt })
    }
  }

  const entries = Array.from(byEmail.entries())
  let marked = 0
  for (let i = 0; i < entries.length; i += UPDATE_CHUNK) {
    // Sent as one JSON parameter: drizzle's sql template would expand a JS array into separate params.
    const rows = JSON.stringify(
      entries.slice(i, i + UPDATE_CHUNK).map(([email, v]) => ({ email, verdict: v.verdict, checked_at: v.checkedAt })),
    )
    const result = await tx.execute(sql`
      update ${contacts} as c
      set
        status = 'undeliverable',
        updated_at = now(),
        metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
          '_email_verify_reachable', r.verdict,
          '_email_verify_checked_at', r.checked_at
        )
      from jsonb_to_recordset(${rows}::jsonb) as r(email text, verdict text, checked_at text)
      where lower(trim(c.email)) = r.email
        and c.status in ('active', 'pending', 'undeliverable')
        and coalesce(
          nullif(trim(both from coalesce(c.metadata->>'_email_verify_checked_at', '')), '')::timestamptz <= r.checked_at::timestamptz,
          true
        )
      returning c.id
    `)
    marked += result.rowCount ?? 0
  }
  return marked
}

export async function listExists(listId: string): Promise<boolean> {
  const [row] = await db.select({ id: lists.id }).from(lists).where(eq(lists.id, listId))
  return !!row
}
