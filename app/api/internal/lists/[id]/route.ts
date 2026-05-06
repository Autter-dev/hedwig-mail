import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { lists, contacts } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { auditFromSession, logAudit } from '@/lib/audit'
import { updateListSchema } from '@/lib/validations/lists'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const [list] = await db
    .select()
    .from(lists)
    .where(eq(lists.id, params.id))

  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const [counts] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      active: sql<number>`cast(count(case when ${contacts.status} = 'active' then 1 end) as int)`,
      bounced: sql<number>`cast(count(case when ${contacts.status} = 'bounced' then 1 end) as int)`,
      unsubscribed: sql<number>`cast(count(case when ${contacts.status} = 'unsubscribed' then 1 end) as int)`,
      pending: sql<number>`cast(count(case when ${contacts.status} = 'pending' then 1 end) as int)`,
      undeliverable: sql<number>`cast(count(case when ${contacts.status} = 'undeliverable' then 1 end) as int)`,
    })
    .from(contacts)
    .where(eq(contacts.listId, params.id))

  return NextResponse.json({
    ...list,
    counts: counts ?? { total: 0, active: 0, bounced: 0, unsubscribed: 0, pending: 0, undeliverable: 0 },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateListSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.description !== undefined) updates.description = parsed.data.description
  if (parsed.data.requireDoubleOptIn !== undefined) updates.requireDoubleOptIn = parsed.data.requireDoubleOptIn

  const [updated] = await db
    .update(lists)
    .set(updates)
    .where(eq(lists.id, params.id))
    .returning()

  if (!updated) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'list.update',
    { type: 'list', id: updated.id },
    { changes: parsed.data },
  )

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const [list] = await db.select().from(lists).where(eq(lists.id, params.id))
  await db.delete(lists).where(eq(lists.id, params.id))

  if (list) {
    await logAudit(
      await auditFromSession(req),
      'list.delete',
      { type: 'list', id: params.id },
      { name: list.name },
    )
  }

  return NextResponse.json({ success: true })
}
