/**
 * Import this first in database test files. lib/db reads DATABASE_URL when it is
 * first imported, so this points it at TEST_DATABASE_URL before anything else
 * loads. Tests never fall back to DATABASE_URL, because they delete data.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

if (!TEST_DATABASE_URL && process.env.CI) {
  throw new Error('TEST_DATABASE_URL must be set in CI')
}

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL
} else {
  delete process.env.DATABASE_URL
}

export const skipWithoutDatabase: string | false = TEST_DATABASE_URL
  ? false
  : 'set TEST_DATABASE_URL to run database tests'
