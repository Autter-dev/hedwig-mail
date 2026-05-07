import { SESClient, SendRawEmailCommand, GetAccountSendingEnabledCommand } from '@aws-sdk/client-ses'
import { randomBytes } from 'crypto'
import type { EmailProviderAdapter, SendOptions, ProviderConfig } from './types'
import { logger, trackEvent, trackError } from '@/lib/logger'

const CRLF = '\r\n'

function hasNonAscii(value: string): boolean {
  return /[^\x20-\x7e]/.test(value)
}

function encodeHeaderValue(value: string): string {
  if (!hasNonAscii(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeAddress(name: string, email: string): string {
  if (!name) return email
  const encoded = encodeHeaderValue(name)
  return `${encoded} <${email}>`
}

function buildRawMime(options: SendOptions): string {
  const boundary = `----=_HedwigMail_${randomBytes(12).toString('hex')}`
  const replyTo = options.replyTo?.trim()
  const headers: Record<string, string> = {
    From: encodeAddress(options.fromName, options.from),
    To: options.to,
    Subject: encodeHeaderValue(options.subject),
    ...(replyTo ? { 'Reply-To': replyTo } : {}),
    'MIME-Version': '1.0',
    'Content-Type': `multipart/alternative; boundary="${boundary}"`,
    ...(options.headers || {}),
  }

  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join(CRLF)

  const textPart = options.text ?? ''
  const htmlPart = options.html

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textPart, 'utf8').toString('base64').replace(/(.{76})/g, `$1${CRLF}`),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlPart, 'utf8').toString('base64').replace(/(.{76})/g, `$1${CRLF}`),
    `--${boundary}--`,
    '',
  ].join(CRLF)

  return `${headerLines}${CRLF}${CRLF}${body}`
}

export class SESAdapter implements EmailProviderAdapter {
  private client: SESClient

  constructor(config: ProviderConfig) {
    this.client = new SESClient({
      region: config.region!,
      credentials: {
        accessKeyId: config.apiKey!.split(':')[0],
        secretAccessKey: config.apiKey!.split(':')[1],
      },
    })
    logger.info({ region: config.region }, 'SESAdapter created')
  }

  async send(options: SendOptions): Promise<{ messageId: string }> {
    const startTime = Date.now()
    logger.info({ to: options.to, from: options.from, subject: options.subject, headerKeys: Object.keys(options.headers || {}) }, 'SES: sending email')

    try {
      const rawMessage = buildRawMime(options)
      const result = await this.client.send(new SendRawEmailCommand({
        Source: `${options.fromName} <${options.from}>`,
        Destinations: [options.to],
        RawMessage: { Data: Buffer.from(rawMessage, 'utf8') },
      }))

      const durationMs = Date.now() - startTime
      logger.info({ to: options.to, messageId: result.MessageId, durationMs }, 'SES: email sent successfully')
      trackEvent('email_sent', { provider: 'ses', durationMs })
      return { messageId: result.MessageId! }
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.error({ to: options.to, err, durationMs }, 'SES: send failed')
      trackError(err, { provider: 'ses', action: 'send', to: options.to, durationMs })
      throw err
    }
  }

  async validate(): Promise<boolean> {
    const startTime = Date.now()
    logger.info('SES: validating connection')
    try {
      await this.client.send(new GetAccountSendingEnabledCommand({}))
      const durationMs = Date.now() - startTime
      logger.info({ durationMs }, 'SES: validation successful')
      trackEvent('provider_validated', { provider: 'ses', valid: true, durationMs })
      return true
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.error({ err, durationMs }, 'SES: validation failed')
      trackError(err, { provider: 'ses', action: 'validate', durationMs })
      return false
    }
  }
}
