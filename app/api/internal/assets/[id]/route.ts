import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { assets } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { deleteFile } from '@/lib/storage'
import { renameAssetSchema } from '@/lib/validations/assets'
import { auditFromSession, logAudit } from '@/lib/audit'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = renameAssetSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const [updated] = await db
    .update(assets)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(assets.id, params.id))
    .returning()

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'asset.rename',
    { type: 'asset', id: updated.id },
    { name: updated.name },
  )

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, params.id))
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await deleteFile(asset.s3Key)
  } catch (err) {
    console.error('asset delete: s3 removal failed', { id: asset.id, err })
  }

  await db.delete(assets).where(eq(assets.id, params.id))

  await logAudit(
    await auditFromSession(req),
    'asset.delete',
    { type: 'asset', id: asset.id },
    { name: asset.name, kind: asset.kind },
  )

  return NextResponse.json({ success: true })
}
