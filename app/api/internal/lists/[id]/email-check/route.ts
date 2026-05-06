import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { lists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { checkEmail } from '@/lib/email-checker/checkEmail'
import { internalListEmailCheckSchema } from '@/lib/validations/email-check'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = internalListEmailCheckSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const [list] = await db.select().from(lists).where(eq(lists.id, params.id))
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const result = await checkEmail({
    to_email: parsed.data.email.trim().toLowerCase(),
    check_gravatar: false,
  })

  return NextResponse.json({ result, listId: list.id })
}
