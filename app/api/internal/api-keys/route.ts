import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { nanoid } from 'nanoid'
import bcrypt from 'bcryptjs'
import { createApiKeySchema } from '@/lib/validations/api-keys'
import { auditFromSession, logAudit } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth-helpers'

export async function GET() {
  const guard = await requireAdmin()
  if (guard) return guard

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt)

  return NextResponse.json(keys)
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

  const parsed = createApiKeySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const rawKey = nanoid(32)
  const keyHash = await bcrypt.hash(rawKey, 10)

  const [created] = await db
    .insert(apiKeys)
    .values({
      name: parsed.data.name,
      keyHash,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      createdAt: apiKeys.createdAt,
    })

  await logAudit(
    await auditFromSession(req),
    'api_key.create',
    { type: 'api_key', id: created.id },
    { name: created.name },
  )

  return NextResponse.json({ ...created, key: rawKey }, { status: 201 })
}
