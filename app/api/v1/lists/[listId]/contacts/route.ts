import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { contacts, lists } from '@/lib/db/schema'
import { eq, ilike, and, count, SQL } from 'drizzle-orm'
import { withApiAuth } from '@/lib/api-auth'
import { createContactSchema } from '@/lib/validations/contacts'
import { auditFromApiKey, logAudit } from '@/lib/audit'
import { getQueue, JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { enqueueContactEmailVerification } from '@/lib/email-verify'

export async function GET(
  req: NextRequest,
  { params }: { params: { listId: string } }
) {
  return withApiAuth(req, async () => {
    const { searchParams } = req.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
    const limit = Math.min(Math.max(1, rawLimit), 200)
    const offset = (page - 1) * limit

    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const conditions: SQL[] = [eq(contacts.listId, params.listId)]
    if (status) conditions.push(eq(contacts.status, status))
    if (search) conditions.push(ilike(contacts.email, `%${search}%`))

    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(contacts)
      .where(where)

    const data = await db
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        metadata: contacts.metadata,
        status: contacts.status,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(contacts.createdAt)

    return NextResponse.json({
      data,
      meta: { page, limit, total },
      error: null,
    })
  })
}

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

    const parsed = createContactSchema.safeParse(body)
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

    // A contact already in this list is a conflict, not a server error. Integrations
    // retry on 5xx, so answering a duplicate with 500 makes them retry forever.
    const [created] = await db
      .insert(contacts)
      .values({
        listId: params.listId,
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        metadata: parsed.data.metadata ?? {},
        ...(requireDoubleOptIn
          ? { status: 'pending', confirmationToken: randomUUID() }
          : {}),
      })
      .onConflictDoNothing({ target: [contacts.listId, contacts.email] })
      .returning()

    if (!created) {
      const [existing] = await db
        .select({ id: contacts.id, email: contacts.email, status: contacts.status })
        .from(contacts)
        .where(and(eq(contacts.listId, params.listId), eq(contacts.email, parsed.data.email)))
      return NextResponse.json(
        {
          data: existing ?? null,
          meta: {},
          error: 'A contact with this email already exists in this list',
        },
        { status: 409 },
      )
    }

    // The contact exists from here on, so nothing below may fail the request. A 5xx
    // would make the caller retry, and every retry would then be a duplicate.
    if (requireDoubleOptIn) {
      await runSideEffect('enqueue confirmation job', created.id, async () => {
        const queue = await getQueue()
        await queue.send(JOBS.SEND_CONFIRMATION, { contactId: created.id })
      })
    }

    await runSideEffect('enqueue email verification', created.id, () =>
      enqueueContactEmailVerification([created.id]),
    )

    await runSideEffect('write audit log', created.id, () =>
      logAudit(
        auditFromApiKey(req, auth),
        'contact.create',
        { type: 'contact', id: created.id },
        { listId: params.listId, email: created.email, requireDoubleOptIn },
      ),
    )

    return NextResponse.json({ data: created, meta: {}, error: null }, { status: 201 })
  })
}

async function runSideEffect(label: string, contactId: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    logger.error({ err, contactId }, `Failed to ${label} after creating contact`)
  }
}
