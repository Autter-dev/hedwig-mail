import { Resend } from 'resend'
import type { EmailProviderAdapter, SendOptions, ProviderConfig } from './types'
import { logger, trackEvent, trackError } from '@/lib/logger'

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
    logger.info('ResendAdapter created')
  }

  async send(options: SendOptions): Promise<{ messageId: string }> {
    const startTime = Date.now()
    const from = formatFromAddress(options.fromName, options.from)
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
