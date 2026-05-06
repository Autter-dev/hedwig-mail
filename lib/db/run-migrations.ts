import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const MIGRATION_LOCK_KEY = 704214891337551

export async function runMigrationsWithLock(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 1,
  })
  const db = drizzle(pool)

  try {
    console.log('Waiting for migration lock...')
    await pool.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    console.log('Migration lock acquired.')

    console.log('Running migrations...')
    await migrate(db, { migrationsFolder: './drizzle/migrations' })
    console.log('Migrations complete.')
  } finally {
    try {
      await pool.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      console.log('Migration lock released.')
    } catch {
      // Ignore unlock errors, pool shutdown still runs.
    }
    await pool.end()
  }
}
