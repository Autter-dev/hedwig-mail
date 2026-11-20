import { and, eq, ilike, type SQL } from 'drizzle-orm'
import { suppressions } from '@/lib/db/schema'
import { SUPPRESSION_REASONS } from '@/lib/validations/suppressions'

export type SuppressionReasonFilter = (typeof SUPPRESSION_REASONS)[number]

export interface SuppressionListQuery {
  page: number
  limit: number
  search: string
  reason: SuppressionReasonFilter | null
}

export type ParsedSuppressionListQuery =
  | { ok: true; query: SuppressionListQuery }
  | { ok: false; error: string }

/**
 * Parse `page`, `limit`, `search` and `reason` from a suppressions list
 * request. An unknown `reason` is an error rather than "no filter", so a
 * typo never silently returns every suppression.
 */
export function parseSuppressionListQuery(searchParams: URLSearchParams): ParsedSuppressionListQuery {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10) || 50
  const limit = Math.min(200, Math.max(1, limitRaw))
  const search = (searchParams.get('search') ?? '').trim()
  const rawReason = (searchParams.get('reason') ?? '').trim().toLowerCase()
  if (rawReason && rawReason !== 'all' && !(SUPPRESSION_REASONS as readonly string[]).includes(rawReason)) {
    return { ok: false, error: `Unknown reason "${rawReason}". Use one of: ${SUPPRESSION_REASONS.join(', ')}.` }
  }
  const reason = rawReason && rawReason !== 'all' ? (rawReason as SuppressionReasonFilter) : null
  return { ok: true, query: { page, limit, search, reason } }
}

/** The WHERE clause for a list query; undefined when nothing is filtered. */
export function suppressionListWhere(query: Pick<SuppressionListQuery, 'search' | 'reason'>): SQL | undefined {
  const conditions: SQL[] = []
  if (query.search) conditions.push(ilike(suppressions.email, `%${query.search.toLowerCase()}%`))
  if (query.reason) conditions.push(eq(suppressions.reason, query.reason))
  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}
