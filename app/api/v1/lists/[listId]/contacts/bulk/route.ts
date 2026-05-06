import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { contacts, lists } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { withApiAuth } from '@/lib/api-auth'
import { bulkContactsSchema } from '@/lib/validations/contacts'
import { auditFromApiKey, logAudit } from '@/lib/audit'
import { getQueue, JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { enqueueContactEmailVerification } from '@/lib/email-verify'

export async function POST(
  req: NextRequest,
  { params }: { params: { listId: string } }
) {
  return withApiAuth(req, async (auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', data: null, meta: {} }, { status: 400 })
    }

    const parsed = bulkContactsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', data: null, meta: { details: parsed.error.flatten() } },
        { status: 400 }
      )
    }

    const [list] = await db.select().from(lists).where(eq(lists.id, params.listId))
    if (!list) {
      return NextResponse.json({ error: 'List not found', data: null, meta: {} }, { status: 404 })
    }
    const requireDoubleOptIn = list.requireDoubleOptIn

    let inserted = 0
    let updated = 0
    let skipped = 0
    const newContactIds: string[] = []
    const verifiedContactIds: string[] = []

    const batchSize = 500
    const items = parsed.data.contacts

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const values = batch.map((c) => ({
        listId: params.listId,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        metadata: c.metadata ?? {},
        ...(requireDoubleOptIn
          ? { status: 'pending', confirmationToken: randomUUID() }
          : {}),
      }))

      try {
        const result = await db
          .insert(contacts)
          .values(values)
          .onConflictDoUpdate({
            target: [contacts.listId, contacts.email],
            set: {
              firstName: sql`excluded.first_name`,
              lastName: sql`excluded.last_name`,
              metadata: sql`excluded.metadata`,
              updatedAt: new Date(),
            },
          })
          .returning({ id: contacts.id, isInsert: sql<boolean>`xmax = 0` })

        for (const row of result) {
          verifiedContactIds.push(row.id)
          if (row.isInsert) {
            inserted++
            if (requireDoubleOptIn) newContactIds.push(row.id)
          } else {
            updated++
          }
        }
      } catch {
        skipped += batch.length
      }
    }

    await enqueueContactEmailVerification(verifiedContactIds)

    if (requireDoubleOptIn && newContactIds.length > 0) {
      try {
        const queue = await getQueue()
        await Promise.all(
          newContactIds.map((contactId) =>
            queue.send(JOBS.SEND_CONFIRMATION, { contactId }),
          ),
        )
      } catch (err) {
        logger.error({ err, listId: params.listId, count: newContactIds.length }, 'Failed to enqueue confirmation jobs')
      }
    }

    await logAudit(
      auditFromApiKey(req, auth),
      'contact.upsert_bulk',
      { type: 'list', id: params.listId },
      { inserted, updated, skipped, total: items.length, requireDoubleOptIn },
    )

    return NextResponse.json({
      data: { inserted, updated, skipped },
      meta: {},
      error: null,
    })
  })
}
