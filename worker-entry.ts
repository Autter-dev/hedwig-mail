import { runMigrationsWithLock } from './lib/db/run-migrations'

async function main() {
  await runMigrationsWithLock()
  await import('./worker')
}

main().catch((err) => {
  console.error('Worker bootstrap failed', err)
  process.exit(1)
})
