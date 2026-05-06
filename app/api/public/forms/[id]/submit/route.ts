import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { contacts, forms, formSubmissions } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { isSuppressed, normalizeEmail } from '@/lib/suppressions'
import { consumeIpToken, extractIp } from '@/lib/rate-limit/ip'
import { getQueue, JOBS } from '@/lib/queue'
import type { FormField } from '@/lib/db/schema'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

interface SubmissionPayload {
  email: string
  fields: Record<string, string>
  honeypot: string
}

async function readBody(req: NextRequest): Promise<SubmissionPayload | null> {
  const contentType = req.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const json = await req.json()
      return {
        email: typeof json.email === 'string' ? json.email : '',
        fields: typeof json.fields === 'object' && json.fields ? json.fields : {},
        honeypot: typeof json._hp === 'string' ? json._hp : '',
      }
    }
    const fd = await req.formData()
    const fields: Record<string, string> = {}
    let email = ''
    let honeypot = ''
    fd.forEach((value, key) => {
      if (typeof value !== 'string') return
      if (key === 'email') email = value
      else if (key === '_hp') honeypot = value
      else fields[key] = value
    })
    return { email, fields, honeypot }
  } catch {
    return null
  }
}

function buildContactWrites(fields: FormField[], submitted: Record<string, string>) {
  let firstName: string | undefined
  let lastName: string | undefined
  const metadata: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'email') continue
    const raw = submitted[field.key]
    if (typeof raw !== 'string') continue
    const value = raw.slice(0, 1000)
    if (field.key === 'first_name') firstName = value
    else if (field.key === 'last_name') lastName = value
    else if (value !== '') metadata[field.key] = value
  }
  return { firstName, lastName, metadata }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = extractIp(req.headers)
  const limit = consumeIpToken(ip, `form:${params.id}`, { capacity: 10, refillPerSecond: 10 / 60 })
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(limit.resetSeconds) } },
    )
  }

  const payload = await readBody(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400, headers: CORS })
  }

  // Honeypot: pretend it succeeded so bots don't learn
  if (payload.honeypot) {
    return NextResponse.json({ ok: true, message: 'ok' }, { headers: CORS })
  }

  const email = normalizeEmail(payload.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400, headers: CORS })
  }

  const [form] = await db.select().from(forms).where(eq(forms.id, params.id))
  if (!form) {
    return NextResponse.json({ ok: false, error: 'Form not found' }, { status: 404, headers: CORS })
  }

  for (const field of form.fields) {
    if (field.type === 'email' || !field.required) continue
    const value = payload.fields[field.key]
    if (typeof value !== 'string' || value.trim() === '') {
      return NextResponse.json(
        { ok: false, error: `Field '${field.label}' is required` },
        { status: 400, headers: CORS },
      )
    }
    if (field.type === 'select' && field.options && !field.options.includes(value)) {
      return NextResponse.json(
        { ok: false, error: `Field '${field.label}' has an invalid value` },
        { status: 400, headers: CORS },
      )
    }
  }

  const successResponse = NextResponse.json(
    { ok: true, message: form.successMessage, redirectUrl: form.redirectUrl ?? null },
    { headers: CORS },
  )

  const userAgent = req.headers.get('user-agent') || null
  const submittedFields = payload.fields
  async function recordSubmission(outcome: string, contactId: string | null) {
    await db.insert(formSubmissions).values({
      formId: form.id,
      contactId,
      email,
      payload: submittedFields,
      outcome,
      ipAddress: ip || null,
      userAgent,
    })
  }

  // Suppression: silently succeed without DB write or email send
  if (await isSuppressed(email)) {
    await recordSubmission('suppressed', null)
    return successResponse
  }

  const { firstName, lastName, metadata } = buildContactWrites(form.fields, payload.fields)

  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.listId, form.listId), eq(contacts.email, email)))
    .limit(1)

  if (existing) {
    if (existing.status === 'unsubscribed' || existing.status === 'bounced' || existing.status === 'undeliverable') {
      await recordSubmission('suppressed', existing.id)
      return successResponse
    }
    if (existing.status === 'pending' && form.doubleOptIn) {
      const newToken = randomUUID()
      await db
        .update(contacts)
        .set({
          firstName: firstName ?? existing.firstName,
          lastName: lastName ?? existing.lastName,
          metadata: { ...(existing.metadata ?? {}), ...metadata },
          confirmationToken: newToken,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existing.id))

      const boss = await getQueue()
      await boss.send(JOBS.SEND_CONFIRMATION_EMAIL, { contactId: existing.id, formId: form.id }, { retryLimit: 3 })
      await recordSubmission('pending', existing.id)
      return successResponse
    }
    await recordSubmission('duplicate', existing.id)
    return successResponse
  }

  if (form.doubleOptIn) {
    const confirmationToken = randomUUID()
    const [created] = await db
      .insert(contacts)
      .values({
        listId: form.listId,
        email,
        firstName,
        lastName,
        metadata,
        status: 'pending',
        confirmationToken,
      })
      .onConflictDoNothing({ target: [contacts.listId, contacts.email] })
      .returning()

    if (!created) {
      await recordSubmission('duplicate', null)
      return successResponse
    }

    const boss = await getQueue()
    await boss.send(JOBS.SEND_CONFIRMATION_EMAIL, { contactId: created.id, formId: form.id }, { retryLimit: 3 })
    await recordSubmission('pending', created.id)
    return successResponse
  }

  const [created] = await db
    .insert(contacts)
    .values({
      listId: form.listId,
      email,
      firstName,
      lastName,
      metadata,
      status: 'active',
    })
    .onConflictDoNothing({ target: [contacts.listId, contacts.email] })
    .returning()

  await recordSubmission(created ? 'created' : 'duplicate', created?.id ?? null)
  return successResponse
}
