import type { Contact } from '@/lib/db/schema'

export type ContactStatus = 'active' | 'bounced' | 'unsubscribed' | 'undeliverable'

export type DedupCandidate = Pick<
  Contact,
  'id' | 'email' | 'firstName' | 'lastName' | 'metadata' | 'status' | 'updatedAt'
>

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function completenessScore(contact: DedupCandidate): number {
  let score = 0
  if (contact.firstName && contact.firstName.trim().length > 0) score += 1
  if (contact.lastName && contact.lastName.trim().length > 0) score += 1
  const meta = contact.metadata ?? {}
  score += Object.keys(meta).filter((k) => {
    const v = meta[k]
    return v !== null && v !== undefined && String(v).length > 0
  }).length
  return score
}

const STATUS_RANK: Record<string, number> = {
  unsubscribed: 4,
  bounced: 3,
  undeliverable: 2,
  pending: 1,
  active: 0,
}

export function worstStatus(statuses: string[]): ContactStatus {
  let worst: ContactStatus = 'active'
  let worstRank = -1
  for (const s of statuses) {
    const rank = STATUS_RANK[s] ?? 0
    if (rank > worstRank) {
      worstRank = rank
      worst = (s as ContactStatus) ?? 'active'
    }
  }
  return worst
}

/**
 * Default winner = most recently updated, ties broken by completeness, then by id for determinism.
 */
export function pickWinner(candidates: DedupCandidate[]): DedupCandidate {
  if (candidates.length === 0) {
    throw new Error('pickWinner requires at least one candidate')
  }
  const sorted = [...candidates].sort((a, b) => {
    const at = new Date(a.updatedAt).getTime()
    const bt = new Date(b.updatedAt).getTime()
    if (bt !== at) return bt - at
    const cs = completenessScore(b) - completenessScore(a)
    if (cs !== 0) return cs
    return a.id.localeCompare(b.id)
  })
  return sorted[0]
}

export interface MergedFields {
  firstName: string | null
  lastName: string | null
  metadata: Record<string, string>
  status: ContactStatus
}

export function mergeFields(
  winner: DedupCandidate,
  losers: DedupCandidate[],
): MergedFields {
  const all = [winner, ...losers]

  const firstNonEmpty = (vals: (string | null | undefined)[]): string | null => {
    for (const v of vals) {
      if (v && v.trim().length > 0) return v
    }
    return null
  }

  const firstName = firstNonEmpty([
    winner.firstName,
    ...losers.map((l) => l.firstName),
  ])
  const lastName = firstNonEmpty([
    winner.lastName,
    ...losers.map((l) => l.lastName),
  ])

  // Shallow merge metadata: losers first so winner keys overwrite on conflict.
  const metadata: Record<string, string> = {}
  for (const c of [...losers, winner]) {
    const m = c.metadata ?? {}
    for (const [k, v] of Object.entries(m)) {
      if (v !== null && v !== undefined && String(v).length > 0) {
        metadata[k] = String(v)
      }
    }
  }

  const status = worstStatus(all.map((c) => c.status))

  return { firstName, lastName, metadata, status }
}
