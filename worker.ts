import { PgBoss } from 'pg-boss'
import { db } from './lib/db'
import { campaigns, campaignSends, contacts, emailProviders, forms } from './lib/db/schema'
import { checkEmail } from './lib/email-checker/checkEmail'
import { eq, sql } from 'drizzle-orm'
import { createProviderAdapter } from './lib/providers/factory'
import { renderTemplate, renderPlainText } from './lib/renderer'
import { JOBS } from './lib/queue'
import { logger, trackEvent, trackError, shutdownTracking } from './lib/logger'
import { isSuppressed } from './lib/suppressions'
import { sendConfirmation } from './lib/email/sendConfirmation'
import { logAudit, systemAuditCtx } from './lib/audit'
import { ensureEmailVerifySmtpDefaults, getEmailVerifySmtpIdentity } from './lib/settings/email-verify-smtp'
import { runEmailVerifyBackfillOnWorkerStart } from './lib/email-verify-backfill'

const APP_URL = process.env.APP_URL!
const TRACKING_URL = (process.env.TRACKING_URL || process.env.APP_URL || '').replace(/\/$/, '')
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5')

if (/localhost|127\.0\.0\.1/i.test(APP_URL)) {
  logger.warn(
    { appUrl: APP_URL },
    'APP_URL points to localhost. External email clients (Gmail, Outlook) cannot reach this host, so embedded images and tracking pixels will not load. Use a public URL or a tunnel (ngrok, cloudflared) for real sends.'
  )
}

async function processSendJob(sendId: string, campaignId: string) {
  const startTime = Date.now()
  logger.info({ sendId, campaignId }, 'Processing send job')

  // Fetch campaign from DB
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))

  if (campaign) {
    logger.info({
      sendId,
      campaignId,
      campaignSubject: campaign.subject,
      campaignStatus: campaign.status,
      templateJsonType: typeof campaign.templateJson,
      templateJsonIsArray: Array.isArray(campaign.templateJson),
      templateJsonLength: Array.isArray(campaign.templateJson) ? campaign.templateJson.length : 'N/A',
      templateJsonPreview: JSON.stringify(campaign.templateJson)?.substring(0, 500),
      templateHtmlLength: campaign.templateHtml ? campaign.templateHtml.length : 0,
      templateHtmlPreview: campaign.templateHtml ? campaign.templateHtml.substring(0, 200) : null,
    }, 'Fetched campaign template data from DB')
  }

  // Check for cancel
  if (!campaign || campaign.cancelRequested) {
    logger.warn({ sendId, campaignId, cancelRequested: campaign?.cancelRequested }, 'Campaign cancelled or not found, skipping send')
    await db.update(campaignSends).set({ status: 'failed', errorMessage: 'Cancelled' }).where(eq(campaignSends.id, sendId))
    trackEvent('email_send_skipped', { sendId, campaignId, reason: 'cancelled' })
    return
  }

  const [send] = await db.select().from(campaignSends).where(eq(campaignSends.id, sendId))
  if (!send) {
    logger.warn({ sendId }, 'Send record not found, skipping')
    return
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, send.contactId))
  if (!contact || contact.status !== 'active') {
    logger.warn({ sendId, contactId: send.contactId, contactStatus: contact?.status }, 'Contact not active, skipping send')
    await db.update(campaignSends).set({ status: 'failed', errorMessage: 'Contact not active' }).where(eq(campaignSends.id, sendId))
    trackEvent('email_send_skipped', { sendId, campaignId, reason: 'contact_not_active' })
    return
  }

  if (await isSuppressed(contact.email)) {
    logger.warn({ sendId, contactId: send.contactId, contactEmail: contact.email }, 'Email is globally suppressed, skipping send')
    await db.update(campaignSends).set({ status: 'failed', errorMessage: 'Globally suppressed' }).where(eq(campaignSends.id, sendId))
    trackEvent('email_send_skipped', { sendId, campaignId, reason: 'suppressed' })
    return
  }

  const [provider] = await db.select().from(emailProviders).where(eq(emailProviders.id, campaign.providerId!))
  if (!provider) {
    logger.error({ sendId, campaignId, providerId: campaign.providerId }, 'Provider not found')
    trackError(new Error('Provider not found'), { sendId, campaignId, providerId: campaign.providerId })
    throw new Error('Provider not found')
  }

  logger.info(
    { sendId, campaignId, contactEmail: contact.email, providerType: provider.type },
    'Preparing email for send'
  )

  const adapter = createProviderAdapter(provider.type, provider.configEncrypted)

  const unsubscribeUrl = `${TRACKING_URL}/unsubscribe/${contact.unsubscribeToken}`
  const contactData: Record<string, string> = {
    email: contact.email,
    first_name: contact.firstName || '',
    last_name: contact.lastName || '',
    unsubscribe_url: unsubscribeUrl,
    ...(contact.metadata as Record<string, string>),
  }

  logger.info({
    sendId,
    contactEmail: contact.email,
    contactDataKeys: Object.keys(contactData),
    contactFirstName: contactData.first_name,
    contactLastName: contactData.last_name,
  }, 'Contact data prepared for merge tags')

  logger.info({ sendId, contactEmail: contact.email }, 'Rendering email template')
  const html = renderTemplate({
    blocks: campaign.templateJson,
    contact: contactData,
    sendId: send.id,
    appUrl: APP_URL,
    trackingUrl: TRACKING_URL,
    unsubscribeUrl,
    rawHtml: campaign.templateHtml,
    disableTracking: campaign.disableTracking,
  })

  logger.info({
    sendId,
    renderedHtmlLength: html.length,
    renderedHtmlPreview: html.substring(0, 500),
    htmlContainsBody: html.includes('<body'),
    htmlContainsUnsubscribe: html.includes('Unsubscribe'),
  }, 'Rendered email HTML for inspection')

  const text = renderPlainText(html)

  logger.info({ sendId, contactEmail: contact.email, subject: campaign.subject, htmlLength: html.length, textLength: text.length }, 'Sending email via provider')
  const { messageId } = await adapter.send({
    to: contact.email,
    from: campaign.fromEmail,
    fromName: campaign.fromName,
    subject: campaign.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })

  await db.update(campaignSends).set({
    status: 'sent',
    providerMessageId: messageId,
    sentAt: new Date(),
  }).where(eq(campaignSends.id, send.id))

  const durationMs = Date.now() - startTime
  logger.info(
    { sendId, campaignId, contactEmail: contact.email, messageId, durationMs },
    'Email sent and recorded successfully'
  )
  trackEvent('email_send_complete', { sendId, campaignId, providerType: provider.type, durationMs })
}

async function processVerifyContactEmail(contactId: string) {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId))
  if (!contact) {
    logger.warn({ contactId }, 'Verify email: contact not found')
    return
  }
  if (contact.status === 'unsubscribed' || contact.status === 'bounced') {
    logger.info({ contactId, status: contact.status }, 'Verify email: skipped terminal status')
    return
  }

  const { fromEmail, helloName } = await getEmailVerifySmtpIdentity()
  const result = await checkEmail({
    to_email: contact.email,
    from_email: fromEmail,
    hello_name: helloName,
  })
  const verdict = result.is_reachable

  const prevMeta = (contact.metadata as Record<string, string> | null) ?? {}
  const metadata: Record<string, string> = {
    ...prevMeta,
    _email_verify_reachable: verdict,
    _email_verify_checked_at: new Date().toISOString(),
  }
  if ('error' in result.smtp) {
    metadata._email_verify_smtp_error = JSON.stringify(result.smtp.error)
  }

  if (contact.status === 'pending') {
    if (verdict === 'invalid' || verdict === 'risky') {
      await db
        .update(contacts)
        .set({ status: 'undeliverable', metadata, updatedAt: new Date() })
        .where(eq(contacts.id, contactId))
    } else {
      await db.update(contacts).set({ metadata, updatedAt: new Date() }).where(eq(contacts.id, contactId))
    }
    return
  }

  if (verdict === 'invalid' || verdict === 'risky') {
    await db
      .update(contacts)
      .set({ status: 'undeliverable', metadata, updatedAt: new Date() })
      .where(eq(contacts.id, contactId))
  } else if (contact.status === 'undeliverable') {
    await db.update(contacts).set({ status: 'active', metadata, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  } else {
    await db.update(contacts).set({ metadata, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  }

  logger.info({ contactId, verdict, email: contact.email }, 'Contact email verification complete')
  trackEvent('contact_email_verified', { contactId, verdict })
}

async function processConfirmationJob(contactId: string, formId: string) {
  logger.info({ contactId, formId }, 'Processing confirmation email job')

  const [form] = await db.select().from(forms).where(eq(forms.id, formId))
  if (!form) {
    logger.warn({ contactId, formId }, 'Form not found, skipping confirmation send')
    return
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId))
  if (!contact) {
    logger.warn({ contactId, formId }, 'Contact not found, skipping confirmation send')
    return
  }
  if (contact.status !== 'pending' || !contact.confirmationToken) {
    logger.info({ contactId, formId, status: contact.status }, 'Contact not pending, skipping confirmation send')
    return
  }

  if (await isSuppressed(contact.email)) {
    logger.warn({ contactId, contactEmail: contact.email }, 'Email suppressed, skipping confirmation send')
    return
  }

  let provider = null
  if (form.providerId) {
    const rows = await db.select().from(emailProviders).where(eq(emailProviders.id, form.providerId))
    provider = rows[0] ?? null
  }
  if (!provider) {
    const rows = await db.select().from(emailProviders).where(eq(emailProviders.isDefault, true))
    provider = rows[0] ?? null
  }
  if (!provider) {
    logger.error({ contactId, formId }, 'No provider configured for confirmation email')
    throw new Error('No provider configured')
  }

  const adapter = createProviderAdapter(provider.type, provider.configEncrypted)

  const confirmUrl = `${APP_URL}/confirm/${contact.confirmationToken}`
  const html = renderTemplate({
    blocks: form.confirmationTemplateJson,
    contact: {
      email: contact.email,
      first_name: contact.firstName || '',
      last_name: contact.lastName || '',
      confirm_url: confirmUrl,
    },
    sendId: '',
    appUrl: APP_URL,
    unsubscribeUrl: '',
    disableTracking: true,
    footerHtml: null,
  })

  const text = renderPlainText(html)

  const fromEmail = form.fromEmail || ''
  const fromName = form.fromName || ''

  await adapter.send({
    to: contact.email,
    from: fromEmail,
    fromName,
    subject: form.confirmationSubject || 'Please confirm your subscription',
    html,
    text,
  })

  logger.info({ contactId, formId, contactEmail: contact.email }, 'Confirmation email sent')
  trackEvent('form_confirmation_sent', { formId, contactId })
}

async function main() {
  logger.info({ concurrency: CONCURRENCY, appUrl: APP_URL }, 'Worker starting')

  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    max: 10,
  })

  await boss.start()
  logger.info('pg-boss started')

  // Create queues if they don't exist (required in pg-boss v12+)
  for (const queue of [
    JOBS.SEND_EMAIL,
    JOBS.FINALIZE_CAMPAIGN,
    JOBS.SEND_CONFIRMATION,
    JOBS.SEND_CONFIRMATION_EMAIL,
    JOBS.PURGE_AUDIT_LOGS,
    JOBS.VERIFY_CONTACT_EMAIL,
  ]) {
    try {
      await boss.createQueue(queue)
      logger.info({ queue }, 'Queue created')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (!msg.includes('already exists')) throw e
      logger.debug({ queue }, 'Queue already exists')
    }
  }
  logger.info('All queues ready')

  await ensureEmailVerifySmtpDefaults()
  const backfillEnqueued = await runEmailVerifyBackfillOnWorkerStart(boss)
  if (backfillEnqueued > 0) {
    logger.info({ enqueued: backfillEnqueued }, 'Email verification backfill queued at worker startup')
  }

  // Process individual email send jobs
  await boss.work<{ sendId: string; campaignId: string }>(
    JOBS.SEND_EMAIL,
    { localConcurrency: CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processSendJob(job.data.sendId, job.data.campaignId)
        } catch (err) {
          logger.error(
            { err, sendId: job.data.sendId, campaignId: job.data.campaignId, jobId: job.id },
            'Send job failed'
          )
          trackError(err, { action: 'send_job', sendId: job.data.sendId, campaignId: job.data.campaignId })

          // Mark the send as failed in the database
          try {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            await db.update(campaignSends)
              .set({ status: 'failed', errorMessage })
              .where(eq(campaignSends.id, job.data.sendId))
            await logAudit(
              systemAuditCtx(undefined, 'worker'),
              'campaign_send.failed',
              { type: 'campaign_send', id: job.data.sendId },
              { campaignId: job.data.campaignId, errorMessage },
            )
          } catch (dbErr) {
            logger.error({ err: dbErr, sendId: job.data.sendId }, 'Failed to update send status after error')
          }
        }
      }
    }
  )

  // Send signup-form confirmation emails (transactional, double opt-in)
  await boss.work<{ contactId: string; formId: string }>(
    JOBS.SEND_CONFIRMATION_EMAIL,
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processConfirmationJob(job.data.contactId, job.data.formId)
        } catch (err) {
          logger.error(
            { err, contactId: job.data.contactId, formId: job.data.formId, jobId: job.id },
            'Confirmation email job failed'
          )
          trackError(err, {
            action: 'confirmation_email_job',
            contactId: job.data.contactId,
            formId: job.data.formId,
          })
          throw err
        }
      }
    }
  )

  // Finalize campaign after all sends complete
  await boss.work<{ campaignId: string }>(JOBS.FINALIZE_CAMPAIGN, async (jobs) => {
    for (const job of jobs) {
      const { campaignId } = job.data
      logger.info({ campaignId }, 'Finalizing campaign')
      try {
        await db.update(campaigns).set({ status: 'sent', sentAt: new Date() }).where(eq(campaigns.id, campaignId))

        const [stats] = await db
          .select({
            total: sql<number>`count(*)::int`,
            sent: sql<number>`count(case when ${campaignSends.status} = 'sent' then 1 end)::int`,
            failed: sql<number>`count(case when ${campaignSends.status} = 'failed' then 1 end)::int`,
          })
          .from(campaignSends)
          .where(eq(campaignSends.campaignId, campaignId))

        await logAudit(
          systemAuditCtx(undefined, 'worker'),
          'campaign.finalized',
          { type: 'campaign', id: campaignId },
          {
            totalRecipients: stats?.total ?? 0,
            sent: stats?.sent ?? 0,
            failed: stats?.failed ?? 0,
          },
        )

        logger.info({ campaignId }, 'Campaign finalized successfully')
        trackEvent('campaign_finalized', { campaignId })
      } catch (err) {
        logger.error({ err, campaignId }, 'Failed to finalize campaign')
        trackError(err, { action: 'finalize_campaign', campaignId })
      }
    }
  })

  // Send double opt-in confirmation emails
  await boss.work<{ contactId: string }>(JOBS.SEND_CONFIRMATION, async (jobs) => {
    for (const job of jobs) {
      const { contactId } = job.data
      logger.info({ contactId, jobId: job.id }, 'Processing confirmation send job')
      try {
        await sendConfirmation(contactId)
        trackEvent('confirmation_email_sent', { contactId })
      } catch (err) {
        logger.error({ err, contactId, jobId: job.id }, 'Confirmation send job failed')
        trackError(err, { action: 'send_confirmation', contactId })
        throw err
      }
    }
  })

  await boss.work<{ contactId: string }>(JOBS.VERIFY_CONTACT_EMAIL, async (jobs) => {
    for (const job of jobs) {
      const { contactId } = job.data
      try {
        await processVerifyContactEmail(contactId)
      } catch (err) {
        logger.error({ err, contactId, jobId: job.id }, 'Verify contact email job failed')
        trackError(err, { action: 'verify_contact_email', contactId })
        throw err
      }
    }
  })

  // Periodic audit log retention purge
  await boss.work<Record<string, never>>(JOBS.PURGE_AUDIT_LOGS, async (jobs) => {
    for (const job of jobs) {
      const days = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '365', 10)
      if (!Number.isFinite(days) || days <= 0) {
        logger.info({ jobId: job.id, days }, 'Audit log retention disabled, skipping purge')
        continue
      }
      logger.info({ jobId: job.id, days }, 'Purging audit logs')
      try {
        const result = await db.execute(sql`select * from audit_logs_retention_purge(${days}::int)`)
        const rows = (result as unknown as { rows?: { deleted: number; cutoff: string }[] }).rows
          ?? (Array.isArray(result) ? (result as { deleted: number; cutoff: string }[]) : [])
        const row = rows[0]
        await logAudit(
          systemAuditCtx(undefined, 'retention'),
          'audit.retention_purge',
          { type: 'audit_log', id: null },
          { deleted: row?.deleted ?? 0, cutoff: row?.cutoff ?? null, retentionDays: days },
        )
        logger.info({ deleted: row?.deleted, cutoff: row?.cutoff }, 'Audit log purge complete')
      } catch (err) {
        logger.error({ err }, 'Audit log purge failed')
        trackError(err, { action: 'purge_audit_logs' })
      }
    }
  })

  try {
    await boss.schedule(JOBS.PURGE_AUDIT_LOGS, '0 3 * * *', {}, { tz: 'UTC' })
    logger.info('Audit log retention scheduled (daily 03:00 UTC)')
  } catch (err) {
    logger.warn({ err }, 'Failed to schedule audit log retention; will continue without it')
  }

  logger.info('Worker ready, processing jobs')
  trackEvent('worker_started', { concurrency: CONCURRENCY })

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down worker')
    await boss.stop()
    await shutdownTracking()
    process.exit(0)
  })
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Worker failed to start')
  trackError(err, { action: 'worker_startup' })
  await shutdownTracking()
  process.exit(1)
})
