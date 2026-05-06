import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { lists, contacts } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { createListSchema } from '@/lib/validations/lists'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function GET() {
  const rows = await db
    .select({
      id: lists.id,
      name: lists.name,
      description: lists.description,
      createdAt: lists.createdAt,
      updatedAt: lists.updatedAt,
      requireDoubleOptIn: lists.requireDoubleOptIn,
      total: sql<number>`cast(count(${contacts.id}) as int)`,
      active: sql<number>`cast(count(case when ${contacts.status} = 'active' then 1 end) as int)`,
      bounced: sql<number>`cast(count(case when ${contacts.status} = 'bounced' then 1 end) as int)`,
      unsubscribed: sql<number>`cast(count(case when ${contacts.status} = 'unsubscribed' then 1 end) as int)`,
      pending: sql<number>`cast(count(case when ${contacts.status} = 'pending' then 1 end) as int)`,
      undeliverable: sql<number>`cast(count(case when ${contacts.status} = 'undeliverable' then 1 end) as int)`,
    })
    .from(lists)
    .leftJoin(contacts, eq(contacts.listId, lists.id))
    .groupBy(lists.id)
    .orderBy(lists.createdAt)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createListSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const [created] = await db
    .insert(lists)
    .values({
      name: parsed.data.name,
      description: parsed.data.description,
      requireDoubleOptIn: parsed.data.requireDoubleOptIn ?? false,
    })
    .returning()

  await logAudit(
    await auditFromSession(req),
    'list.create',
    { type: 'list', id: created.id },
    { name: created.name },
  )

  return NextResponse.json(created, { status: 201 })
}
