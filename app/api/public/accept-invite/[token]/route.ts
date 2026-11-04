import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { teamInvites, users } from '@/lib/db/schema'
import { hashInviteToken } from '@/lib/team/tokens'
import { acceptInviteSchema } from '@/lib/validations/team'
import { logAudit, systemAuditCtx } from '@/lib/audit'

async function findValidInvite(token: string) {
  const tokenHash = hashInviteToken(token)
  const invite = await db.query.teamInvites.findFirst({ where: eq(teamInvites.tokenHash, tokenHash) })
  if (!invite) return { reason: 'invalid' as const }
  if (invite.revokedAt) return { reason: 'revoked' as const }
  if (invite.acceptedAt) return { reason: 'used' as const }
  if (invite.expiresAt.getTime() < Date.now()) return { reason: 'expired' as const }
  return { invite }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const result = await findValidInvite(params.token)
  if ('reason' in result) {
    return NextResponse.json({ valid: false, reason: result.reason })
  }
  return NextResponse.json({
    valid: true,
    email: result.invite.email,
    role: result.invite.role,
    expiresAt: result.invite.expiresAt,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = acceptInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((e) => e.message).join(', ') },
      { status: 400 },
    )
  }

  const result = await findValidInvite(params.token)
  if ('reason' in result) {
    return NextResponse.json({ error: 'Invite is invalid, expired, or already used' }, { status: 400 })
  }
  const invite = result.invite

  const existing = await db.query.users.findFirst({ where: eq(users.email, invite.email) })
  if (existing) {
    await db
      .update(teamInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(teamInvites.id, invite.id))
    return NextResponse.json(
      { error: 'A member with this email already exists. Sign in instead.' },
      { status: 400 },
    )
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10)

  const [created] = await db
    .insert(users)
    .values({
      email: invite.email,
      name: parsed.data.name?.length ? parsed.data.name : null,
      passwordHash,
      role: invite.role === 'admin' ? 'admin' : 'member',
    })
    .returning({ id: users.id, email: users.email, role: users.role })

  await db
    .update(teamInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(teamInvites.id, invite.id))

  await logAudit(
    systemAuditCtx(req, 'accept-invite'),
    'team.invite.accepted',
    { type: 'user', id: created.id },
    { email: created.email, role: created.role, inviteId: invite.id },
  )

  return NextResponse.json({ success: true, email: created.email })
}
