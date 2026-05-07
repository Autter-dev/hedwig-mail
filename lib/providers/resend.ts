import { Resend } from 'resend'
import type { EmailProviderAdapter, SendOptions, ProviderConfig } from './types'
import { logger, trackEvent, trackError } from '@/lib/logger'

function parseResendEmailsPerSecondLimit(): number {
  const raw = process.env.RESEND_EMAILS_PER_SECOND
  const parsed = raw ? Number.parseInt(raw, 10) : 2
  if (!Number.isFinite(parsed) || parsed <= 0) return 2
  return parsed
}

const RESEND_EMAILS_PER_SECOND_LIMIT = parseResendEmailsPerSecondLimit()
const RESEND_MIN_INTERVAL_MS = Math.ceil(1000 / RESEND_EMAILS_PER_SECOND_LIMIT)
let resendLimiterTail: Promise<void> = Promise.resolve()
let resendNextAvailableAt = Date.now()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reserveResendCapacity(emailCount: number): Promise<void> {
  const slotCount = Math.max(1, emailCount)
  const reservationWindowMs = slotCount * RESEND_MIN_INTERVAL_MS

  const reserve = async () => {
    const now = Date.now()
    if (resendNextAvailableAt < now) resendNextAvailableAt = now
    const waitMs = resendNextAvailableAt - now
    if (waitMs > 0) {
      logger.debug({ waitMs, slotCount }, 'Resend throttle: waiting for available slot')
      await sleep(waitMs)
    }
    resendNextAvailableAt = Math.max(resendNextAvailableAt, Date.now()) + reservationWindowMs
  }

  const reservation = resendLimiterTail.then(reserve, reserve)
  resendLimiterTail = reservation.catch(() => {})
  await reservation
}

function formatFromAddress(fromName: string, fromEmail: string): string {
  const trimmedName = fromName.trim()
  if (!trimmedName) return fromEmail

  // Prevent header injection and ensure the display name is preserved.
  const safeName = trimmedName.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${safeName}" <${fromEmail}>`
}

export class ResendAdapter implements EmailProviderAdapter {
  private client: Resend

  constructor(config: ProviderConfig) {
    this.client = new Resend(config.apiKey!)
    logger.info({ resendEmailsPerSecondLimit: RESEND_EMAILS_PER_SECOND_LIMIT }, 'ResendAdapter created')
  }

  async send(options: SendOptions): Promise<{ messageId: string }> {
    const startTime = Date.now()
    const from = formatFromAddress(options.fromName, options.from)
    await reserveResendCapacity(1)
    logger.info({ to: options.to, from, subject: options.subject }, 'Resend: sending email')

    const { data, error } = await this.client.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      replyTo: options.replyTo,
      html: options.html,
      text: options.text,
      headers: options.headers,
    })

    const durationMs = Date.now() - startTime

    if (error) {
      logger.error({ to: options.to, error: error.message, durationMs }, 'Resend: send failed')
      trackError(new Error(error.message), {
        provider: 'resend',
        action: 'send',
        to: options.to,
        durationMs,
      })
      throw new Error(error.message)
    }

    logger.info({ to: options.to, messageId: data!.id, durationMs }, 'Resend: email sent successfully')
    trackEvent('email_sent', { provider: 'resend', durationMs })
    return { messageId: data!.id }
  }

  async sendBatch(options: SendOptions[]): Promise<{ messageIds: string[] }> {
    const startTime = Date.now()
    if (options.length === 0) return { messageIds: [] }
    await reserveResendCapacity(options.length)

    const payload = options.map((item) => ({
      from: formatFromAddress(item.fromName, item.from),
      to: [item.to],
      subject: item.subject,
      replyTo: item.replyTo,
      html: item.html,
      text: item.text,
      headers: item.headers,
    }))

    logger.info(
      { count: payload.length, recipients: options.map((item) => item.to) },
      'Resend: sending batch email'
    )

    const { data, error } = await this.client.batch.send(payload)
    const durationMs = Date.now() - startTime

    if (error) {
      logger.error({ error: error.message, durationMs, count: payload.length }, 'Resend: batch send failed')
      trackError(new Error(error.message), {
        provider: 'resend',
        action: 'send_batch',
        durationMs,
        count: payload.length,
      })
      throw new Error(error.message)
    }

    const messageIds = (data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
    logger.info(
      { count: payload.length, sentCount: messageIds.length, durationMs },
      'Resend: batch email sent successfully'
    )
    trackEvent('email_batch_sent', { provider: 'resend', count: payload.length, sentCount: messageIds.length, durationMs })
    return { messageIds }
  }

  async validate(): Promise<boolean> {
    const startTime = Date.now()
    logger.info('Resend: validating connection')
    try {
      const result = await this.client.domains.list()
      const durationMs = Date.now() - startTime
      logger.info({ durationMs, domainCount: result.data?.data?.length ?? 0 }, 'Resend: validation successful')
      trackEvent('provider_validated', { provider: 'resend', valid: true, durationMs })
      return true
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.error({ err, durationMs }, 'Resend: validation failed')
      trackError(err, { provider: 'resend', action: 'validate', durationMs })
      return false
    }
  }
}
