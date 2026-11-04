import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { forms, lists, formSubmissions } from '@/lib/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { createFormSchema } from '@/lib/validations/forms'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function GET() {
  const rows = await db
    .select({
      id: forms.id,
      name: forms.name,
      listId: forms.listId,
      listName: lists.name,
      doubleOptIn: forms.doubleOptIn,
      createdAt: forms.createdAt,
      updatedAt: forms.updatedAt,
      submissionCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${formSubmissions} WHERE ${formSubmissions.formId} = ${forms.id}), 0)`,
    })
    .from(forms)
    .leftJoin(lists, eq(lists.id, forms.listId))
    .orderBy(desc(forms.createdAt))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createFormSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const [created] = await db
    .insert(forms)
    .values({
      name: parsed.data.name,
      listId: parsed.data.listId,
      providerId: parsed.data.providerId ?? null,
      fromName: parsed.data.fromName ?? '',
      fromEmail: parsed.data.fromEmail ?? '',
      fields: parsed.data.fields,
      doubleOptIn: parsed.data.doubleOptIn,
      confirmationSubject: parsed.data.confirmationSubject ?? '',
      confirmationTemplateJson: parsed.data.confirmationTemplateJson ?? [],
      successMessage: parsed.data.successMessage,
      redirectUrl: parsed.data.redirectUrl ?? null,
      brandingLogoFileId: parsed.data.brandingLogoFileId ?? null,
      brandingPrimaryColor: parsed.data.brandingPrimaryColor ?? null,
      brandingBgColor: parsed.data.brandingBgColor ?? null,
      brandingTextColor: parsed.data.brandingTextColor ?? null,
    })
    .returning()

  await logAudit(
    await auditFromSession(req),
    'form.create',
    { type: 'form', id: created.id },
    { name: created.name, listId: created.listId, doubleOptIn: created.doubleOptIn },
  )

  return NextResponse.json(created, { status: 201 })
}
