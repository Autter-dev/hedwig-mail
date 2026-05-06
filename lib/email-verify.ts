import { getQueue, JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { parseEmailVerifyEnqueueStaggerMs } from '@/lib/email-verify-rate'

const CHUNK = 200
const INSERT_CHUNK = 400

/**
 * Enqueues background SMTP verification for contacts. Idempotent per contactId.
 * When EMAIL_VERIFY_ENQUEUE_STAGGER_MS is set, jobs use staggered startAfter so the queue does not wake everything at once.
 */
export async function enqueueContactEmailVerification(contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return
  try {
    const queue = await getQueue()
    const staggerMs = parseEmailVerifyEnqueueStaggerMs()

    if (staggerMs <= 0) {
      for (let i = 0; i < contactIds.length; i += CHUNK) {
        const slice = contactIds.slice(i, i + CHUNK)
        await Promise.all(slice.map((contactId) => queue.send(JOBS.VERIFY_CONTACT_EMAIL, { contactId })))
      }
      return
    }

    const now = Date.now()
    const jobs = contactIds.map((contactId, index) => ({
      data: { contactId },
      startAfter: new Date(now + index * staggerMs),
    }))
    for (let i = 0; i < jobs.length; i += INSERT_CHUNK) {
      await queue.insert(JOBS.VERIFY_CONTACT_EMAIL, jobs.slice(i, i + INSERT_CHUNK))
    }
  } catch (err) {
    logger.error({ err, count: contactIds.length }, 'Failed to enqueue email verification jobs')
  }
}
