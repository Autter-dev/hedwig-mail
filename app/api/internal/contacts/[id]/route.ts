import { NextRequest, NextResponse } from 'next/server'
import { hardDeleteContact } from '@/lib/gdpr'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await hardDeleteContact(params.id)

  if (!result) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'contact.delete',
    { type: 'contact', id: params.id },
    {
      email: result.email,
      listId: result.listId,
      sendCount: result.sendCount,
      eventCount: result.eventCount,
    },
  )

  return NextResponse.json({
    deleted: true,
    id: params.id,
    email: result.email,
    sendCount: result.sendCount,
    eventCount: result.eventCount,
  })
}