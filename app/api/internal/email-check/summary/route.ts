import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getEmailCheckSummary, listExists } from '@/lib/email-verify-cleanup'

export async function GET(req: NextRequest) {
  const listIdParam = req.nextUrl.searchParams.get('listId') || undefined
  const listId = z.string().uuid().optional().safeParse(listIdParam)
  if (!listId.success) {
    return NextResponse.json({ error: 'Invalid listId' }, { status: 400 })
  }
  if (listId.data && !(await listExists(listId.data))) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  return NextResponse.json(await getEmailCheckSummary(listId.data))
}
