import { NextRequest, NextResponse } from 'next/server'
import { listExists, removeFlaggedContacts } from '@/lib/email-verify-cleanup'
import { emailCheckRemoveSchema } from '@/lib/validations/email-check'
import { auditFromSession, logAudit } from '@/lib/audit'

const AUDIT_EMAIL_SAMPLE = 100

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = emailCheckRemoveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { listId, contactIds, verdicts, suppress } = parsed.data
  if (listId && !(await listExists(listId))) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const { removed, suppressed, markedElsewhere } = await removeFlaggedContacts({
    listId,
    contactIds,
    verdicts,
    suppress,
  })

  if (removed.length > 0) {
    await logAudit(
      await auditFromSession(req),
      'email_check.remove',
      listId ? { type: 'list', id: listId } : null,
      {
        removed: removed.length,
        suppressed,
        markedElsewhere,
        verdicts: verdicts ?? null,
        emails: removed.slice(0, AUDIT_EMAIL_SAMPLE).map((r) => r.email),
      },
    )
  }

  return NextResponse.json({ removed: removed.length, suppressed, markedElsewhere })
}
