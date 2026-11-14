/** Postgres SQLSTATE for a unique constraint violation. */
export const PG_UNIQUE_VIOLATION = '23505'

/**
 * True when err is a Postgres unique violation. drizzle-orm wraps driver errors in a
 * DrizzleQueryError whose message is the failed SQL, so the SQLSTATE is on `cause`.
 * Walks a few levels of `cause` to find it.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
