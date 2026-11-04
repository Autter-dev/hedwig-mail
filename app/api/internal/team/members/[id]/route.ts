import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-helpers'
import { auditFromSession, logAudit } from '@/lib/audit'
import { updateMemberSchema } from '@/lib/validations/team'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin()
  if (guard) return guard

  const session = await getServerSession(authOptions)
  if (session?.user.id === params.id) {
    return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 })
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, params.id) })
  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const envAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  if (envAdminEmail && target.email.toLowerCase() === envAdminEmail) {
    return NextResponse.json(
      { error: 'Cannot remove the environment admin. Change ADMIN_EMAIL to disable.' },
      { status: 400 },
    )
  }

  await db.delete(users).where(eq(users.id, params.id))

  await logAudit(
    await auditFromSession(req),
    'team.member.removed',
    { type: 'user', id: target.id },
    { email: target.email, role: target.role },
  )

  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin()
  if (guard) return guard

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((e) => e.message).join(', ') },
      { status: 400 },
    )
  }

  const session = await getServerSession(authOptions)
  if (session?.user.id === params.id && parsed.data.role !== 'admin') {
    return NextResponse.json({ error: 'You cannot demote yourself' }, { status: 400 })
  }

  const [updated] = await db
    .update(users)
    .set({ role: parsed.data.role })
    .where(eq(users.id, params.id))
    .returning({ id: users.id, email: users.email, role: users.role })

  if (!updated) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  await logAudit(
    await auditFromSession(req),
    'team.member.role_changed',
    { type: 'user', id: updated.id },
    { email: updated.email, role: updated.role },
  )

  return NextResponse.json(updated)
}
