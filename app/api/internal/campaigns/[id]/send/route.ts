import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { campaigns, campaignSends, contacts, suppressions } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { getQueue, JOBS } from '@/lib/queue'
import { logger, trackEvent } from '@/lib/logger'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now()
  logger.info({ campaignId: params.id }, 'Campaign send requested')

  let body: { scheduledAt?: string; sendRatePerMinute?: number | null } = {}
  try {
    body = await req.json()
  } catch {
    // Body is optional, default to empty object
  }

  const { scheduledAt } = body

  // Validate sendRatePerMinute if provided
  const bodyRate: number | null | undefined = body.sendRatePerMinute
  if (bodyRate !== undefined && bodyRate !== null) {
    if (!Number.isInteger(bodyRate) || bodyRate < 1 || bodyRate > 100000) {
      return NextResponse.json(
        { error: 'sendRatePerMinute must be an integer between 1 and 100000' },
        { status: 400 },
      )
    }
  }

  // Fetch campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, params.id))

  if (!campaign) {
    logger.warn({ campaignId: params.id }, 'Campaign not found for send')
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Validate required fields
  if (!campaign.subject || campaign.subject.trim() === '') {
    logger.warn({ campaignId: params.id }, 'Campaign missing subject')
    return NextResponse.json({ error: 'Campaign is missing a subject line' }, { status: 400 })
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!campaign.fromEmail || !emailRegex.test(campaign.fromEmail)) {
    logger.warn({ campaignId: params.id, fromEmail: campaign.fromEmail }, 'Campaign from email is missing or invalid')
    return NextResponse.json({ error: 'Campaign "From email" is missing or invalid. Set a complete sender address (e.g. you@yourdomain.com) and save before sending.' }, { status: 400 })
  }
  if (campaign.replyToEmail && !emailRegex.test(campaign.replyToEmail)) {
    logger.warn({ campaignId: params.id, replyToEmail: campaign.replyToEmail }, 'Campaign reply-to email is invalid')
    return NextResponse.json(
      { error: 'Campaign "Reply-To" is invalid. Set a complete reply-to address (e.g. replies@yourdomain.com) and save before sending.' },
      { status: 400 },
    )
  }
  if (!campaign.fromName || campaign.fromName.trim() === '') {
    logger.warn({ campaignId: params.id }, 'Campaign missing fromName')
    return NextResponse.json({ error: 'Campaign is missing a from name' }, { status: 400 })
  }
  if (!campaign.providerId) {
    logger.warn({ campaignId: params.id }, 'Campaign missing providerId')
    return NextResponse.json({ error: 'Campaign does not have an email provider selected' }, { status: 400 })
  }
  if (!campaign.listId) {
    logger.warn({ campaignId: params.id }, 'Campaign missing listId')
    return NextResponse.json({ error: 'Campaign does not have a contact list selected' }, { status: 400 })
  }

  // Check that the campaign has email body content (blocks or raw HTML)
  const hasContent = (campaign.templateJson && campaign.templateJson.length > 0) ||
    (campaign.templateHtml && campaign.templateHtml.trim().length > 0)
  if (!hasContent) {
    logger.warn({ campaignId: params.id }, 'Campaign has no email body content')
    return NextResponse.json({ error: 'Campaign has no email content. Add content in the editor and save before sending.' }, { status: 400 })
  }

  logger.info(
    { campaignId: params.id, listId: campaign.listId, providerId: campaign.providerId, scheduledAt },
    'Campaign validation passed, fetching contacts'
  )

  // Fetch active contacts for the list, excluding any whose email is on the global suppression list
  const contactList = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.listId, campaign.listId),
        eq(contacts.status, 'active'),
        sql`NOT EXISTS (SELECT 1 FROM ${suppressions} WHERE ${suppressions.email} = ${contacts.email})`
      )
    )

  if (contactList.length === 0) {
    logger.warn({ campaignId: params.id, listId: campaign.listId }, 'No active contacts in list')
    return NextResponse.json({ error: 'No active contacts in this list' }, { status: 400 })
  }

  logger.info({ campaignId: params.id, contactCount: contactList.length }, 'Contacts fetched, updating campaign status')

  // Resolve send rate: explicit body wins, then persisted campaign value, then null (unlimited)
  const rate = bodyRate !== undefined ? bodyRate : campaign.sendRatePerMinute ?? null
  const perSecond = rate ? Math.max(1, Math.floor(rate / 60)) : null

  // Update campaign status
  const newStatus = scheduledAt ? 'scheduled' : 'sending'
  await db
    .update(campaigns)
    .set({
      status: newStatus,
      totalRecipients: contactList.length,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      sendRatePerMinute: rate,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaign.id))

  // Insert campaign_sends rows in batches of 500
  logger.info({ campaignId: params.id, contactCount: contactList.length }, 'Inserting campaign_sends rows')
  for (let i = 0; i < contactList.length; i += 500) {
    const batch = contactList.slice(i, i + 500)
    await db.insert(campaignSends).values(
      batch.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      }))
    )
    logger.debug({ campaignId: params.id, batchStart: i, batchSize: batch.length }, 'Inserted campaign_sends batch')
  }

  // Fetch all created campaign_sends for this campaign
  const sends = await db
    .select()
    .from(campaignSends)
    .where(eq(campaignSends.campaignId, campaign.id))

  // Enqueue individual send jobs, staggered by sendRatePerMinute when set
  logger.info(
    { campaignId: params.id, sendCount: sends.length, sendRatePerMinute: rate, perSecond },
    'Enqueuing send jobs',
  )
  const queue = await getQueue()
  const baseMs = scheduledAt ? new Date(scheduledAt).getTime() : Date.now()

  for (let i = 0; i < sends.length; i++) {
    const send = sends[i]
    let startAfter: Date | undefined
    if (perSecond) {
      startAfter = new Date(baseMs + Math.floor(i / perSecond) * 1000)
    } else if (scheduledAt) {
      startAfter = new Date(scheduledAt)
    }
    await queue.send(
      JOBS.SEND_EMAIL,
      { sendId: send.id, campaignId: campaign.id },
      startAfter ? { startAfter } : undefined,
    )
  }

  // Enqueue finalize job with rate-aware estimated delay
  const sendWindowSeconds = perSecond
    ? Math.ceil(sends.length / perSecond)
    : Math.ceil(contactList.length / 5) * 2
  const estimatedSeconds = Math.max(60, sendWindowSeconds + 60)
  const finalizeAfter = new Date(baseMs + estimatedSeconds * 1000)

  await queue.send(
    JOBS.FINALIZE_CAMPAIGN,
    { campaignId: campaign.id },
    { startAfter: finalizeAfter }
  )

  const durationMs = Date.now() - startTime
  logger.info(
    { campaignId: params.id, queued: sends.length, status: newStatus, durationMs },
    'Campaign send jobs enqueued successfully'
  )
  trackEvent('campaign_send_initiated', {
    campaignId: params.id,
    contactCount: contactList.length,
    status: newStatus,
    scheduledAt: scheduledAt || null,
    durationMs,
  })

  await logAudit(
    await auditFromSession(req),
    'campaign.send',
    { type: 'campaign', id: campaign.id },
    {
      totalRecipients: contactList.length,
      scheduledAt: scheduledAt ?? null,
      status: newStatus,
    },
  )

  return NextResponse.json({ queued: sends.length })
}
