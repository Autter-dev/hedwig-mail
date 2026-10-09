import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FLAGGED_VERDICTS, listFlaggedContacts } from '@/lib/email-verify-cleanup'
import { emailCheckVerdictSchema } from '@/lib/validations/email-check'

const querySchema = z.object({
  listId: z.string().uuid().optional(),
  verdict: z.array(emailCheckVerdictSchema).optional(),
  search: z.string().trim().max(320).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const verdicts = sp.getAll('verdict')
  const parsed = querySchema.safeParse({
    listId: sp.get('listId') || undefined,
    verdict: verdicts.length > 0 ? verdicts : undefined,
    search: sp.get('search') || undefined,
    page: sp.get('page') ?? undefined,
    limit: sp.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { listId, verdict, search, page, limit } = parsed.data
  const { data, total } = await listFlaggedContacts({
    listId,
    verdicts: verdict ?? FLAGGED_VERDICTS,
    search: search?.toLowerCase(),
    page,
    limit,
  })

  return NextResponse.json({ data, meta: { page, limit, total } })
}
