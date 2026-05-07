import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { templates, emailProviders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createProviderAdapter } from '@/lib/providers/factory'
import { renderTemplate, renderPlainText } from '@/lib/renderer'
import { logger, trackEvent, trackError } from '@/lib/logger'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now()

  try {
    const body = await req.json()
    const { toEmail } = body

    if (!toEmail || typeof toEmail !== 'string') {
      return NextResponse.json({ error: 'toEmail is required' }, { status: 400 })
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
      return NextResponse.json(
        { error: 'At least one recipient email is required' },
        { status: 400 }
      )
    }

    const invalidEmails = recipients.filter((e) => !emailRegex.test(e))
    if (invalidEmails.length > 0) {
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

    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, params.id))

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const [provider] = await db
      .select()
      .from(emailProviders)
      .where(eq(emailProviders.isDefault, true))
      .limit(1)

    if (!provider) {
      return NextResponse.json(
        { error: 'No default email provider configured. Set one in Settings, Providers.' },
        { status: 400 }
      )
    }

    const hasContent =
      (template.templateJson && template.templateJson.length > 0) ||
      (template.templateHtml && template.templateHtml.trim().length > 0)
    if (!hasContent) {
      return NextResponse.json(
        { error: 'Template has no email content. Add content in the editor and save before sending.' },
        { status: 400 }
      )
    }

    if (!template.fromEmail || !emailRegex.test(template.fromEmail)) {
      return NextResponse.json(
        { error: 'Template "From email" is missing or invalid. Set a sender address in the editor.' },
        { status: 400 }
      )
    }

    if (!template.fromName || !template.fromName.trim()) {
      return NextResponse.json(
        { error: 'Template "From name" is missing. Set a sender name in the editor.' },
        { status: 400 }
      )
    }

    const adapter = createProviderAdapter(provider.type, provider.configEncrypted)
    const appUrl = process.env.APP_URL!
    const trackingUrl = (process.env.TRACKING_URL || appUrl).replace(/\/$/, '')
    const testUnsubscribeUrl = `${trackingUrl}/unsubscribe/00000000-0000-0000-0000-000000000000`

    const sent: string[] = []
    const failed: { email: string; error: string }[] = []
    const buildSendOptions = (recipient: string) => {
      const html = renderTemplate({
        blocks: template.templateJson,
        contact: { email: recipient, first_name: 'Test', last_name: 'User', unsubscribe_url: testUnsubscribeUrl },
        sendId: 'test-' + Date.now(),
        appUrl,
        trackingUrl,
        unsubscribeUrl: testUnsubscribeUrl,
        rawHtml: template.templateHtml,
      })

      return {
        to: recipient,
        from: template.fromEmail,
        fromName: template.fromName,
        subject: template.subject || 'Test Email',
        html,
        text: renderPlainText(html),
        headers: {
          'List-Unsubscribe': `<${testUnsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    }

    if (provider.type === 'resend' && adapter.sendBatch && recipients.length > 1) {
      try {
        await adapter.sendBatch(recipients.map(buildSendOptions))
        sent.push(...recipients)
      } catch (sendErr) {
        const message = sendErr instanceof Error ? sendErr.message : 'Batch send failed'
        logger.error({ recipients, err: sendErr }, 'Resend batch template test send failed')
        failed.push(...recipients.map((email) => ({ email, error: message })))
      }
    } else {
      for (const recipient of recipients) {
        try {
          await adapter.send(buildSendOptions(recipient))
          sent.push(recipient)
        } catch (sendErr) {
          const message = sendErr instanceof Error ? sendErr.message : 'Send failed'
          logger.error({ recipient, err: sendErr }, 'Template test send failed')
          failed.push({ email: recipient, error: message })
        }
      }
    }

    const durationMs = Date.now() - startTime
    trackEvent('template_test_email_sent', {
      templateId: params.id,
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
      'template.test_send',
      { type: 'template', id: template.id },
      { recipients: sent, failedCount: failed.length },
    )

    return NextResponse.json({ success: true, sent, failed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send test email'
    trackError(err, { action: 'template_test_send', templateId: params.id })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
