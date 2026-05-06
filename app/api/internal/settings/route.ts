import { NextRequest, NextResponse } from 'next/server'
import { getAppSettings, updateAppSettings } from '@/lib/settings'
import { updateAppSettingsSchema } from '@/lib/validations/settings'
import { auditFromSession, logAudit } from '@/lib/audit'

export async function GET() {
  try {
    const settings = await getAppSettings()
    return NextResponse.json(settings)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch settings'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateAppSettingsSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const updated = await updateAppSettings(parsed.data)

    await logAudit(
      await auditFromSession(req),
      'settings.update',
      { type: 'settings', id: updated.id },
      {
        confirmationFromEmail: updated.confirmationFromEmail,
        confirmationFromName: updated.confirmationFromName,
        emailVerifyFromEmail: updated.emailVerifyFromEmail,
        emailVerifyHelloName: updated.emailVerifyHelloName,
        unsubscribePageCustomized: updated.unsubscribePage !== null,
      },
    )

    return NextResponse.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update settings'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
