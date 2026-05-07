import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { campaigns } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, params.id))

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json(campaign)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {}

  if ('name' in body) updateData.name = body.name
  if ('subject' in body) updateData.subject = body.subject
  if ('fromName' in body) updateData.fromName = body.fromName
  if ('fromEmail' in body) updateData.fromEmail = body.fromEmail
  if ('replyToEmail' in body) updateData.replyToEmail = body.replyToEmail
  if ('templateJson' in body) updateData.templateJson = body.templateJson
  if ('templateHtml' in body) updateData.templateHtml = body.templateHtml
  if ('listId' in body) updateData.listId = body.listId
  if ('providerId' in body) updateData.providerId = body.providerId
  if ('disableTracking' in body) updateData.disableTracking = !!body.disableTracking
  if ('sendRatePerMinute' in body) {
    const r = body.sendRatePerMinute
    if (r === null) {
      updateData.sendRatePerMinute = null
    } else if (Number.isInteger(r) && r >= 1 && r <= 100000) {
      updateData.sendRatePerMinute = r
    } else {
      return NextResponse.json(
        { error: 'sendRatePerMinute must be null or an integer between 1 and 100000' },
        { status: 400 },
      )
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'No valid fields provided for update' },
      { status: 400 }
    )
  }

  updateData.updatedAt = new Date()

  const [updated] = await db
    .update(campaigns)
    .set(updateData)
    .where(eq(campaigns.id, params.id))
    .returning()

  if (!updated) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'campaign.update',
    { type: 'campaign', id: updated.id },
    { fields: Object.keys(updateData).filter((k) => k !== 'updatedAt') },
  )

  return NextResponse.json(updated)
}
