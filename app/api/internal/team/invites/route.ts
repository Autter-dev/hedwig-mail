import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { teamInvites, users } from '@/lib/db/schema'
import { requireAdmin } from '@/lib/auth-helpers'
import { auditFromSession, logAudit } from '@/lib/audit'
import { createInviteSchema } from '@/lib/validations/team'
import { generateInviteToken, hashInviteToken } from '@/lib/team/tokens'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const guard = await requireAdmin()
  if (guard) return guard

  const rows = await db
    .select({
      id: teamInvites.id,
      email: teamInvites.email,
      role: teamInvites.role,
      invitedBy: teamInvites.invitedBy,
      expiresAt: teamInvites.expiresAt,
      acceptedAt: teamInvites.acceptedAt,
      revokedAt: teamInvites.revokedAt,
      createdAt: teamInvites.createdAt,
    })
    .from(teamInvites)
    .where(and(isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)))
    .orderBy(desc(teamInvites.createdAt))

  return NextResponse.json(rows)
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

  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((e) => e.message).join(', ') },
      { status: 400 },
    )
  }

  const email = parsed.data.email.toLowerCase().trim()

  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existingUser) {
    return NextResponse.json({ error: 'A member with that email already exists' }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const invitedBy = session?.user.email ?? 'unknown'

  const token = generateInviteToken()
  const tokenHash = hashInviteToken(token)
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)

  const [created] = await db
    .insert(teamInvites)
    .values({
      email,
      role: parsed.data.role,
      tokenHash,
      invitedBy,
      expiresAt,
    })
    .returning({
      id: teamInvites.id,
      email: teamInvites.email,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt,
      createdAt: teamInvites.createdAt,
    })

  await logAudit(
    await auditFromSession(req),
    'team.invite.created',
    { type: 'team_invite', id: created.id },
    { email: created.email, role: created.role, expiresAt: created.expiresAt },
  )

  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const inviteUrl = `${appUrl}/accept-invite/${token}`

  return NextResponse.json({ ...created, token, inviteUrl }, { status: 201 })
}
