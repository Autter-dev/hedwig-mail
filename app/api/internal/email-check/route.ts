import { NextRequest, NextResponse } from 'next/server'
import { checkEmail } from '@/lib/email-checker/checkEmail'
import { getEmailVerifySmtpIdentity } from '@/lib/settings/email-verify-smtp'
import { internalEmailCheckSchema } from '@/lib/validations/email-check'
import { logger } from '@/lib/logger'

// Checks a single address on demand. Does not read or write contacts.
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = internalEmailCheckSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { fromEmail, helloName } = await getEmailVerifySmtpIdentity()
    const result = await checkEmail({
      to_email: parsed.data.email.trim().toLowerCase(),
      from_email: fromEmail,
      hello_name: helloName,
      check_gravatar: false,
    })
    return NextResponse.json({ result })
  } catch (err) {
    // Usually a missing or unreachable checker service. Surface the reason to the dashboard.
    logger.error({ err }, 'Manual email check failed')
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Email check failed: ${message}` }, { status: 502 })
  }
}
