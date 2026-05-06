import { runMigrationsWithLock } from './run-migrations'

async function main() {
  await runMigrationsWithLock()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
