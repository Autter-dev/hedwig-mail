import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { forms } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateFormSchema } from '@/lib/validations/forms'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [form] = await db.select().from(forms).where(eq(forms.id, params.id))
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  return NextResponse.json(form)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateFormSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const [updated] = await db
    .update(forms)
    .set({
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
      updatedAt: new Date(),
    })
    .where(eq(forms.id, params.id))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  await logAudit(
    await auditFromSession(req),
    'form.update',
    { type: 'form', id: updated.id },
    { name: updated.name },
  )

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const [existing] = await db.select().from(forms).where(eq(forms.id, params.id))
  await db.delete(forms).where(eq(forms.id, params.id))
  if (existing) {
    await logAudit(
      await auditFromSession(req),
      'form.delete',
      { type: 'form', id: params.id },
      { name: existing.name },
    )
  }
  return NextResponse.json({ success: true })
}
