import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { suppressions } from '@/lib/db/schema'
import { sql, desc } from 'drizzle-orm'
import { parseSuppressionListQuery, suppressionListWhere } from '@/lib/suppressions/list-query'
import { withApiAuth } from '@/lib/api-auth'
import { createSuppressionSchema } from '@/lib/validations/suppressions'
import { suppressEmail, normalizeEmail } from '@/lib/suppressions'
import { auditFromApiKey, logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const parsed = parseSuppressionListQuery(new URL(req.url).searchParams)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, data: null, meta: {} }, { status: 400 })
    const { page, limit } = parsed.query
    const where = suppressionListWhere(parsed.query)

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

    return NextResponse.json({ data, meta: { page, limit, total }, error: null })
  })
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', data: null, meta: {} }, { status: 400 })
    }

    const parsed = createSuppressionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', data: null, meta: { details: parsed.error.flatten() } },
        { status: 400 }
      )
    }

    const email = normalizeEmail(parsed.data.email)
    await suppressEmail({
      email,
      reason: parsed.data.reason ?? 'manual',
      source: parsed.data.source ?? 'api',
      metadata: parsed.data.metadata,
    })

    const [row] = await db.select().from(suppressions).where(sql`${suppressions.email} = ${email}`).limit(1)

    await logAudit(
      auditFromApiKey(req, auth),
      'suppression.create',
      { type: 'suppression', id: row?.id ?? null },
      { email, reason: parsed.data.reason ?? 'manual', source: parsed.data.source ?? 'api' },
    )

    return NextResponse.json({ data: row, meta: {}, error: null }, { status: 201 })
  })
}
