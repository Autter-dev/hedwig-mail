import { db } from '@/lib/db'
import { appSettings, type AppSettings, type UnsubscribePageContent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const SINGLETON_ID = 'singleton'

export async function getAppSettings(): Promise<AppSettings> {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, SINGLETON_ID)).limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(appSettings)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  const [reread] = await db.select().from(appSettings).where(eq(appSettings.id, SINGLETON_ID)).limit(1)
  return reread
}

export interface AppSettingsPatch {
  confirmationFromEmail?: string | null
  confirmationFromName?: string | null
  emailVerifyFromEmail?: string | null
  emailVerifyHelloName?: string | null
  unsubscribePage?: UnsubscribePageContent | null
}

export async function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  await getAppSettings()
  const [updated] = await db
    .update(appSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appSettings.id, SINGLETON_ID))
    .returning()
  return updated
}

export async function getConfirmationSender(): Promise<{ fromEmail: string; fromName: string }> {
  const settings = await getAppSettings()
  const envFromEmail = process.env.CONFIRMATION_FROM_EMAIL?.trim() || null
  const envFromName = process.env.APP_NAME?.trim() || 'hedwig'

  const fromEmail = settings.confirmationFromEmail?.trim() || envFromEmail
  if (!fromEmail) {
    throw new Error(
      'Confirmation from email is not configured. Set it in Settings > General, or set CONFIRMATION_FROM_EMAIL.',
    )
  }

  const fromName = settings.confirmationFromName?.trim() || envFromName
  return { fromEmail, fromName }
}
