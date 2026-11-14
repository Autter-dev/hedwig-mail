import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { suppressions } from '@/lib/db/schema'
import { ilike, sql, desc } from 'drizzle-orm'
import { createSuppressionSchema } from '@/lib/validations/suppressions'
import { suppressEmail, normalizeEmail } from '@/lib/suppressions'
import { auditFromSession, logAudit } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10) || 50
  const limit = Math.min(200, Math.max(1, limitRaw))
  const search = (searchParams.get('search') ?? '').trim()

  const where = search ? ilike(suppressions.email, `%${search.toLowerCase()}%`) : undefined

  const dataQuery = db
    .select()
    .from(suppressions)
    .orderBy(desc(suppressions.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)

  const data = where ? await dataQuery.where(where) : await dataQuery

  const totalQuery = db.select({ count: sql<number>`count(*)::int` }).from(suppressions)
  const totalRows = where ? await totalQuery.where(where) : await totalQuery
  const total = totalRows[0]?.count ?? 0

  return NextResponse.json({ data, meta: { page, limit, total } })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard) return guard

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createSuppressionSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const email = normalizeEmail(parsed.data.email)
  await suppressEmail({
    email,
    reason: parsed.data.reason ?? 'manual',
    source: parsed.data.source ?? 'manual',
    metadata: parsed.data.metadata,
  })

  const [row] = await db.select().from(suppressions).where(sql`${suppressions.email} = ${email}`).limit(1)

  await logAudit(
    await auditFromSession(req),
    'suppression.create',
    { type: 'suppression', id: row?.id ?? null },
    { email, reason: parsed.data.reason ?? 'manual', source: parsed.data.source ?? 'manual' },
  )

  return NextResponse.json(row, { status: 201 })
}
