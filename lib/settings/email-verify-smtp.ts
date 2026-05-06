import { nanoid } from 'nanoid'
import { getAppSettings, updateAppSettings } from '@/lib/settings'

function hostnameFromAppUrl(): string {
  try {
    const u = process.env.APP_URL || 'http://localhost:3000'
    const host = new URL(u).hostname
    return host && host.length > 0 ? host.replace(/^www\./, '') : 'localhost'
  } catch {
    return 'localhost'
  }
}

/**
 * Ensures app_settings has MAIL FROM and EHLO values for list email verification.
 * Order: existing DB values, then EMAIL_VERIFY_* env pair, then generated defaults (persisted once).
 */
export async function ensureEmailVerifySmtpDefaults(): Promise<void> {
  const s = await getAppSettings()
  const hasFrom = Boolean(s.emailVerifyFromEmail?.trim())
  const hasHello = Boolean(s.emailVerifyHelloName?.trim())
  if (hasFrom && hasHello) return

  const envFrom = process.env.EMAIL_VERIFY_FROM_EMAIL?.trim()
  const envHello = process.env.EMAIL_VERIFY_HELLO_NAME?.trim()
  if (envFrom && envHello) {
    await updateAppSettings({
      emailVerifyFromEmail: envFrom,
      emailVerifyHelloName: envHello,
    })
    return
  }

  const host = hostnameFromAppUrl()
  const fromEmail = `bounce-verify-${nanoid(10)}@${host}`
  const helloName = host
  await updateAppSettings({
    emailVerifyFromEmail: fromEmail,
    emailVerifyHelloName: helloName,
  })
}

export async function getEmailVerifySmtpIdentity(): Promise<{ fromEmail: string; helloName: string }> {
  await ensureEmailVerifySmtpDefaults()
  const s = await getAppSettings()
  const fromEmail = s.emailVerifyFromEmail?.trim()
  const helloName = s.emailVerifyHelloName?.trim()
  if (fromEmail && helloName) {
    return { fromEmail, helloName }
  }
  const host = hostnameFromAppUrl()
  return {
    fromEmail: `bounce-verify-${nanoid(10)}@${host}`,
    helloName: host,
  }
}
