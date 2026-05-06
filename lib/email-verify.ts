import { getQueue, JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'

const CHUNK = 200

/**
 * Enqueues background SMTP verification for contacts. Idempotent per contactId.
 */
export async function enqueueContactEmailVerification(contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return
  try {
    const queue = await getQueue()
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const slice = contactIds.slice(i, i + CHUNK)
      await Promise.all(
        slice.map((contactId) => queue.send(JOBS.VERIFY_CONTACT_EMAIL, { contactId })),
      )
    }
  } catch (err) {
    logger.error({ err, count: contactIds.length }, 'Failed to enqueue email verification jobs')
  }
}
