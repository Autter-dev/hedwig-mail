const DEFAULT_MIN_GAP_MS = 2500
const DEFAULT_WORKER_CONCURRENCY = 1
const MAX_WORKER_CONCURRENCY = 4
const MAX_MIN_GAP_MS = 120_000

export function parseEmailVerifyMinGapMs(): number {
  const raw = parseInt(process.env.EMAIL_VERIFY_MIN_GAP_MS ?? String(DEFAULT_MIN_GAP_MS), 10)
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_MIN_GAP_MS
  return Math.min(raw, MAX_MIN_GAP_MS)
}

export function parseEmailVerifyWorkerConcurrency(): number {
  const raw = parseInt(process.env.EMAIL_VERIFY_WORKER_CONCURRENCY ?? String(DEFAULT_WORKER_CONCURRENCY), 10)
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_WORKER_CONCURRENCY
  return Math.min(raw, MAX_WORKER_CONCURRENCY)
}

/**
 * Milliseconds between each job's scheduled `startAfter` when bulk-enqueueing.
 * 0 disables staggering (jobs become eligible immediately; worker still throttles via min gap).
 */
export function parseEmailVerifyEnqueueStaggerMs(): number {
  const raw = parseInt(process.env.EMAIL_VERIFY_ENQUEUE_STAGGER_MS ?? '0', 10)
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.min(raw, 60_000)
}

export async function sleepEmailVerifyGap(): Promise<void> {
  const ms = parseEmailVerifyMinGapMs()
  if (ms <= 0) return
  await new Promise((r) => setTimeout(r, ms))
}
