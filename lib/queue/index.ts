import { PgBoss } from 'pg-boss'

let boss: PgBoss | null = null

export async function getQueue(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      max: 10,
    })
    await boss.start()
    // Create queues if they don't exist (required in pg-boss v12+)
    for (const queue of [
      JOBS.SEND_EMAIL,
      JOBS.FINALIZE_CAMPAIGN,
      JOBS.PURGE_AUDIT_LOGS,
      JOBS.SEND_CONFIRMATION_EMAIL,
      JOBS.SEND_CONFIRMATION,
      JOBS.VERIFY_CONTACT_EMAIL,
    ]) {
      try {
        await boss.createQueue(queue)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : ''
        if (!msg.includes('already exists')) throw e
      }
    }
  }
  return boss
}

export const JOBS = {
  SEND_CAMPAIGN: 'send-campaign',
  SEND_EMAIL: 'send-email',
  FINALIZE_CAMPAIGN: 'finalize-campaign',
  PURGE_AUDIT_LOGS: 'purge-audit-logs',
  SEND_CONFIRMATION_EMAIL: 'send-confirmation-email',
  SEND_CONFIRMATION: 'send-confirmation',
  VERIFY_CONTACT_EMAIL: 'verify-contact-email',
} as const
