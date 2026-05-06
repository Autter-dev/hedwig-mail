import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import * as XLSX from 'xlsx'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { contacts, lists } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { uploadConfirmSchema } from '@/lib/validations/lists'
import { auditFromSession, logAudit } from '@/lib/audit'
import { getQueue, JOBS } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { enqueueContactEmailVerification } from '@/lib/email-verify'

const s3 = new S3Client({
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
})

const BATCH_SIZE = 500

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = uploadConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { s3Key, mapping } = parsed.data
  const listId = params.id

  const [list] = await db.select().from(lists).where(eq(lists.id, listId))
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  const requireDoubleOptIn = list.requireDoubleOptIn

  // Fetch file from S3
  let buf: Buffer
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: s3Key })
    )
    buf = Buffer.from(await obj.Body!.transformToByteArray())
  } catch {
    return NextResponse.json({ error: 'Failed to retrieve file from storage' }, { status: 500 })
  }

  // Parse spreadsheet
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })

  // Skip header row (index 0), process data rows
  const dataRows = rows.slice(1) as string[][]

  type ContactInsert = {
    listId: string
    email: string
    firstName: string | null
    lastName: string | null
    metadata: Record<string, string>
    status?: string
    confirmationToken?: string | null
  }

  const validContacts: ContactInsert[] = []
  let skipped = 0

  for (const row of dataRows) {
    const emailRaw = row[mapping.email]
    if (!emailRaw || typeof emailRaw !== 'string' || emailRaw.trim() === '') {
      skipped++
      continue
    }

    const email = emailRaw.trim().toLowerCase()

    const firstName =
      mapping.firstName !== undefined && mapping.firstName !== null
        ? (row[mapping.firstName] ?? null)
        : null

    const lastName =
      mapping.lastName !== undefined && mapping.lastName !== null
        ? (row[mapping.lastName] ?? null)
        : null

    const metadata: Record<string, string> = {}
    if (mapping.metadata) {
      for (const { column, key } of mapping.metadata) {
        const val = row[column]
        if (val !== undefined && val !== null) {
          metadata[key] = String(val)
        }
      }
    }

    validContacts.push({
      listId,
      email,
      firstName: firstName ? String(firstName) : null,
      lastName: lastName ? String(lastName) : null,
      metadata,
      ...(requireDoubleOptIn
        ? { status: 'pending', confirmationToken: randomUUID() }
        : {}),
    })
  }

  // Upsert in batches of 500
  let inserted = 0
  let updated = 0
  const newContactIds: string[] = []
  const verifiedContactIds: string[] = []
  for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
    const batch = validContacts.slice(i, i + BATCH_SIZE)
    const returned = await db
      .insert(contacts)
      .values(batch)
      .onConflictDoUpdate({
        target: [contacts.listId, contacts.email],
        set: {
          firstName: sql`EXCLUDED.first_name`,
          lastName: sql`EXCLUDED.last_name`,
          metadata: sql`EXCLUDED.metadata`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: contacts.id, isInsert: sql<boolean>`xmax = 0` })
    for (const row of returned) {
      verifiedContactIds.push(row.id)
      if (row.isInsert) {
        inserted++
        if (requireDoubleOptIn) newContactIds.push(row.id)
      } else {
        updated++
      }
    }
  }

  await enqueueContactEmailVerification(verifiedContactIds)

  if (requireDoubleOptIn && newContactIds.length > 0) {
    try {
      const queue = await getQueue()
      await Promise.all(
        newContactIds.map((contactId) =>
          queue.send(JOBS.SEND_CONFIRMATION, { contactId }),
        ),
      )
    } catch (err) {
      logger.error({ err, listId, count: newContactIds.length }, 'Failed to enqueue confirmation jobs')
    }
  }

  await logAudit(
    await auditFromSession(request),
    'contact.upsert_bulk',
    { type: 'list', id: listId },
    { inserted, updated, skipped, source: 'upload', requireDoubleOptIn },
  )

  return NextResponse.json({
    inserted,
    updated,
    skipped,
  })
}
