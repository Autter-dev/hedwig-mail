import { NextRequest, NextResponse } from 'next/server'
import { mergeGroupsSchema } from '@/lib/validations/duplicates'
import { mergeContactGroup } from '@/lib/dedup/merge'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = mergeGroupsSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const auditCtx = await auditFromSession(req)
  let merged = 0
  let totalReassigned = 0
  let totalDropped = 0
  const errors: Array<{ winnerId: string; message: string }> = []

  for (const group of parsed.data.groups) {
    try {
      const result = await mergeContactGroup(params.id, group.winnerId, group.loserIds)
      merged += 1
      totalReassigned += result.reassignedSends
      totalDropped += result.droppedSends
      await logAudit(
        auditCtx,
        'contact.merged',
        { type: 'contact', id: result.winnerId },
        {
          listId: params.id,
          loserIds: result.loserIds,
          reassignedSends: result.reassignedSends,
          droppedSends: result.droppedSends,
        },
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Merge failed'
      errors.push({ winnerId: group.winnerId, message })
    }
  }

  return NextResponse.json({
    merged,
    reassignedSends: totalReassigned,
    droppedSends: totalDropped,
    errors,
  })
}
