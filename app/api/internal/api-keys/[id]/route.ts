import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditFromSession, logAudit } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth-helpers'

const updateApiKeySchema = z.object({
  rateLimitPerMinute: z.number().int().min(1).max(100000),
})

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin()
  if (guard) return guard

  const [deleted] = await db
    .delete(apiKeys)
    .where(eq(apiKeys.id, params.id))
    .returning({ id: apiKeys.id, name: apiKeys.name })

  if (!deleted) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'api_key.delete',
    { type: 'api_key', id: deleted.id },
    { name: deleted.name },
  )

  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin()
  if (guard) return guard

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateApiKeySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((e) => e.message).join(', ') },
      { status: 400 },
    )
  }

  const [updated] = await db
    .update(apiKeys)
    .set({
      rateLimitPerMinute: parsed.data.rateLimitPerMinute,
      // Reset the bucket capacity so the new limit takes effect immediately.
      rateLimitTokens: parsed.data.rateLimitPerMinute,
      rateLimitUpdatedAt: new Date(),
    })
    .where(eq(apiKeys.id, params.id))
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
    })

  if (!updated) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'api_key.update_rate_limit',
    { type: 'api_key', id: updated.id },
    { name: updated.name, rateLimitPerMinute: updated.rateLimitPerMinute },
  )

  return NextResponse.json(updated)
}
