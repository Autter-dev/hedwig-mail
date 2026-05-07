import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emailProviders } from '@/lib/db/schema'
import { decrypt, encrypt } from '@/lib/encryption'
import { createProviderSchema } from '@/lib/validations/providers'
import { auditFromSession, logAudit } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth-helpers'

interface ProviderConfig {
  apiKey?: string
  region?: string
  replyToEmail?: string
}

function safeProviderView(provider: typeof emailProviders.$inferSelect) {
  let maskedKey: string | undefined
  let region: string | undefined
  let replyToEmail: string | undefined

  try {
    const config: ProviderConfig = JSON.parse(decrypt(provider.configEncrypted))
    replyToEmail = config.replyToEmail

    if (provider.type === 'resend' && config.apiKey) {
      const last4 = config.apiKey.slice(-4)
      maskedKey = `****${last4}`
    } else if (provider.type === 'ses') {
      region = config.region
      if (config.apiKey) {
        const accessKeyId = config.apiKey.split(':')[0] ?? ''
        const last4 = accessKeyId.slice(-4)
        maskedKey = `****${last4}`
      }
    }
  } catch {
    // Config decryption failed: return provider without key details
  }

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    isDefault: provider.isDefault,
    rateLimitPerSecond: provider.rateLimitPerSecond,
    createdAt: provider.createdAt,
    ...(maskedKey !== undefined ? { maskedKey } : {}),
    ...(region !== undefined ? { region } : {}),
    ...(replyToEmail !== undefined ? { replyToEmail } : {}),
  }
}

export async function GET() {
  try {
    const rows = await db.select().from(emailProviders).orderBy(emailProviders.createdAt)
    const safe = rows.map(safeProviderView)
    return NextResponse.json(safe)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch providers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard) return guard

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createProviderSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { name, type, apiKey, region, rateLimitPerSecond, replyToEmail } = parsed.data

  if (type === 'ses' && !region) {
    return NextResponse.json({ error: 'Region is required for SES providers' }, { status: 400 })
  }

  let config: ProviderConfig
  if (type === 'resend') {
    config = { apiKey, replyToEmail }
  } else {
    // ses: store as "accessKeyId:secretKey" so SESAdapter can split on ':'
    config = { apiKey, region, replyToEmail }
  }

  let configEncrypted: string
  try {
    configEncrypted = encrypt(JSON.stringify(config))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Encryption failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  try {
    const [created] = await db
      .insert(emailProviders)
      .values({
        name,
        type,
        configEncrypted,
        rateLimitPerSecond: rateLimitPerSecond ?? 10,
      })
      .returning()

    await logAudit(
      await auditFromSession(req),
      'provider.create',
      { type: 'provider', id: created.id },
      { name: created.name, providerType: created.type },
    )

    return NextResponse.json(safeProviderView(created), { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create provider'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
