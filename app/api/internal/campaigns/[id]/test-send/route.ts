import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { campaigns, emailProviders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createProviderAdapter } from '@/lib/providers/factory'
import type { ProviderConfig } from '@/lib/providers/types'
import { renderTemplate, renderPlainText } from '@/lib/renderer'
import { logger, trackEvent, trackError } from '@/lib/logger'
import { auditFromSession, logAudit } from '@/lib/audit'
import { decrypt } from '@/lib/encryption'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now()
  logger.info({ campaignId: params.id }, 'Test send requested')

  try {
    const body = await req.json()
    const { toEmail } = body

    if (!toEmail || typeof toEmail !== 'string') {
      logger.warn({ campaignId: params.id }, 'Test send missing toEmail')
      return NextResponse.json(
        { error: 'toEmail is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const recipients = Array.from(
      new Set(
        toEmail
          .split(',')
          .map((e) => e.trim())
          .filter((e) => e.length > 0)
      )
    )

    if (recipients.length === 0) {
      logger.warn({ campaignId: params.id }, 'Test send had no recipients after parsing')
      return NextResponse.json(
        { error: 'At least one recipient email is required' },
        { status: 400 }
      )
    }

    const invalidEmails = recipients.filter((e) => !emailRegex.test(e))
    if (invalidEmails.length > 0) {
      logger.warn({ campaignId: params.id, invalidEmails }, 'Test send has invalid email(s)')
      return NextResponse.json(
        { error: `Invalid email address(es): ${invalidEmails.join(', ')}` },
        { status: 400 }
      )
    }

    if (recipients.length > 10) {
      return NextResponse.json(
        { error: 'Cannot send a test to more than 10 recipients at once' },
        { status: 400 }
      )
    }

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, params.id))

    if (!campaign) {
      logger.warn({ campaignId: params.id }, 'Campaign not found for test send')
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (!campaign.providerId) {
      logger.warn({ campaignId: params.id }, 'No provider configured for test send')
      return NextResponse.json(
        { error: 'No email provider configured' },
        { status: 400 }
      )
    }

    const [provider] = await db
      .select()
      .from(emailProviders)
      .where(eq(emailProviders.id, campaign.providerId))

    if (!provider) {
      logger.warn({ campaignId: params.id, providerId: campaign.providerId }, 'Provider not found for test send')
      return NextResponse.json(
        { error: 'Provider not found' },
        { status: 400 }
      )
    }

    // Check that the campaign has some content (blocks or raw HTML)
    const hasContent = (campaign.templateJson && campaign.templateJson.length > 0) ||
      (campaign.templateHtml && campaign.templateHtml.trim().length > 0)
    if (!hasContent) {
      logger.warn({ campaignId: params.id }, 'Campaign has no email body content')
      return NextResponse.json(
        { error: 'Campaign has no email content. Add content in the visual editor or HTML code editor, then save before sending.' },
        { status: 400 }
      )
    }

    if (!campaign.fromEmail || !emailRegex.test(campaign.fromEmail)) {
      logger.warn({ campaignId: params.id, fromEmail: campaign.fromEmail }, 'Campaign from email is missing or invalid')
      return NextResponse.json(
        { error: 'Campaign "From email" is missing or invalid. Set a complete sender address (e.g. you@yourdomain.com) in the editor and save before sending.' },
        { status: 400 }
      )
    }

    if (campaign.replyToEmail && !emailRegex.test(campaign.replyToEmail)) {
      logger.warn({ campaignId: params.id, replyToEmail: campaign.replyToEmail }, 'Campaign reply-to email is invalid')
      return NextResponse.json(
        { error: 'Campaign "Reply-To" is invalid. Set a complete reply-to address (e.g. replies@yourdomain.com) in the editor and save before sending.' },
        { status: 400 }
      )
    }

    if (!campaign.fromName || !campaign.fromName.trim()) {
      logger.warn({ campaignId: params.id }, 'Campaign from name is missing')
      return NextResponse.json(
        { error: 'Campaign "From name" is missing. Set a sender name in the editor and save before sending.' },
        { status: 400 }
      )
    }

    logger.info(
      { campaignId: params.id, recipients, providerType: provider.type, subject: campaign.subject, hasContent },
      'Rendering template and sending test email(s)'
    )

    const providerDefaultReplyTo = (() => {
      try {
        const config: ProviderConfig = JSON.parse(decrypt(provider.configEncrypted))
        return config.replyToEmail?.trim() || undefined
      } catch {
        return undefined
      }
    })()

    const effectiveReplyTo = campaign.replyToEmail?.trim() || providerDefaultReplyTo

    const adapter = createProviderAdapter(provider.type, provider.configEncrypted)

    // Use a dummy but functional unsubscribe URL for test sends
    const appUrl = process.env.APP_URL!
    const trackingUrl = (process.env.TRACKING_URL || appUrl).replace(/\/$/, '')
    const testUnsubscribeUrl = `${trackingUrl}/unsubscribe/00000000-0000-0000-0000-000000000000`

    if (/localhost|127\.0\.0\.1/i.test(appUrl)) {
      logger.warn(
        { appUrl, campaignId: params.id },
        'APP_URL is localhost: external email clients cannot fetch images or the tracking pixel from this URL. Use a tunnel (ngrok, cloudflared) or a public deployment for end-to-end testing.'
      )
    }

    const sent: string[] = []
    const failed: { email: string; error: string }[] = []

    for (const recipient of recipients) {
      try {
        const html = renderTemplate({
          blocks: campaign.templateJson,
          contact: { email: recipient, first_name: 'Test', last_name: 'User', unsubscribe_url: testUnsubscribeUrl },
          sendId: 'test-' + Date.now(),
          appUrl,
          trackingUrl,
          unsubscribeUrl: testUnsubscribeUrl,
          rawHtml: campaign.templateHtml,
          disableTracking: campaign.disableTracking,
        })

        await adapter.send({
          to: recipient,
          from: campaign.fromEmail,
          fromName: campaign.fromName,
          subject: campaign.subject || 'Test Email',
          replyTo: effectiveReplyTo,
          html,
          text: renderPlainText(html),
          headers: {
            'List-Unsubscribe': `<${testUnsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
        sent.push(recipient)
      } catch (sendErr) {
        const message = sendErr instanceof Error ? sendErr.message : 'Send failed'
        logger.error({ recipient, err: sendErr }, 'Test send to recipient failed')
        failed.push({ email: recipient, error: message })
      }
    }

    const durationMs = Date.now() - startTime
    logger.info({ campaignId: params.id, sent, failed, durationMs }, 'Test email batch complete')
    trackEvent('test_email_sent', {
      campaignId: params.id,
      providerType: provider.type,
      sentCount: sent.length,
      failedCount: failed.length,
      durationMs,
    })

    if (sent.length === 0) {
      return NextResponse.json(
        { error: failed[0]?.error || 'Failed to send test emails', failed },
        { status: 500 }
      )
    }

    await logAudit(
      await auditFromSession(req),
      'campaign.test_send',
      { type: 'campaign', id: campaign.id },
      { recipients: sent, failedCount: failed.length },
    )

    return NextResponse.json({ success: true, sent, failed })
  } catch (err) {
    const durationMs = Date.now() - startTime
    const message = err instanceof Error ? err.message : 'Failed to send test email'
    logger.error({ err, campaignId: params.id, durationMs }, 'Test send failed')
    trackError(err, { action: 'test_send', campaignId: params.id, durationMs })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
