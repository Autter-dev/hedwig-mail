import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { contacts, lists } from '@/lib/db/schema'
import { sql, inArray } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit = Math.min(Math.max(1, rawLimit), 200)
  const offset = (page - 1) * limit
  const search = (searchParams.get('search') ?? '').trim().toLowerCase()

  const normEmailExpr = sql<string>`lower(trim(${contacts.email}))`

  const allGroupRows = search
    ? await db
        .select({
          normEmail: normEmailExpr,
          listCount: sql<number>`count(distinct ${contacts.listId})::int`,
        })
        .from(contacts)
        .where(sql`lower(trim(${contacts.email})) like ${'%' + search + '%'}`)
        .groupBy(normEmailExpr)
        .having(sql`count(distinct ${contacts.listId}) > 1`)
    : await db
        .select({
          normEmail: normEmailExpr,
          listCount: sql<number>`count(distinct ${contacts.listId})::int`,
        })
        .from(contacts)
        .groupBy(normEmailExpr)
        .having(sql`count(distinct ${contacts.listId}) > 1`)

  const total = allGroupRows.length
  const sortedGroups = [...allGroupRows].sort((a, b) => a.normEmail.localeCompare(b.normEmail))
  const pageGroups = sortedGroups.slice(offset, offset + limit)

  if (pageGroups.length === 0) {
    return NextResponse.json({ data: [], meta: { page, limit, total } })
  }

  const pageEmails = pageGroups.map((g) => g.normEmail)
  const matchingContacts = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      listId: contacts.listId,
      status: contacts.status,
      normEmail: normEmailExpr,
    })
    .from(contacts)
    .where(inArray(normEmailExpr, pageEmails))

  const listIds = Array.from(new Set(matchingContacts.map((c) => c.listId)))
  const listRows = listIds.length
    ? await db.select({ id: lists.id, name: lists.name }).from(lists).where(inArray(lists.id, listIds))
    : []
  const listNameById = new Map(listRows.map((l) => [l.id, l.name]))

  const byNormEmail = new Map<string, typeof matchingContacts>()
  for (const c of matchingContacts) {
    const key = c.normEmail
    const arr = byNormEmail.get(key) ?? []
    arr.push(c)
    byNormEmail.set(key, arr)
  }

  const data = pageGroups.map((g) => ({
    normEmail: g.normEmail,
    lists: (byNormEmail.get(g.normEmail) ?? []).map((c) => ({
      contactId: c.id,
      listId: c.listId,
      listName: listNameById.get(c.listId) ?? '(deleted list)',
      email: c.email,
      status: c.status,
    })),
  }))

  return NextResponse.json({
    data,
    meta: { page, limit, total },
  })
}
