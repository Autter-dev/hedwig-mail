import { NextRequest, NextResponse } from 'next/server'
import { listExists, startEmailCheckRun } from '@/lib/email-verify-cleanup'
import { emailCheckVerifySchema } from '@/lib/validations/email-check'
import { auditFromSession, logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = emailCheckVerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { listId, scope } = parsed.data
  if (listId && !(await listExists(listId))) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  let result: { queued: number; capped: boolean }
  try {
    result = await startEmailCheckRun(listId, scope)
  } catch (err) {
    logger.error({ err, listId, scope }, 'Failed to start email check run')
    return NextResponse.json({ error: 'Could not queue verification jobs' }, { status: 500 })
  }

  if (result.queued > 0) {
    await logAudit(
      await auditFromSession(req),
      'email_check.verify',
      listId ? { type: 'list', id: listId } : null,
      { scope, queued: result.queued },
    )
  }

  return NextResponse.json(result)
}
