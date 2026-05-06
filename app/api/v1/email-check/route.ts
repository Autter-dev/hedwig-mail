import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { checkEmail } from '@/lib/email-checker/checkEmail'
import { getEmailVerifySmtpIdentity } from '@/lib/settings/email-verify-smtp'
import { v1EmailCheckSchema } from '@/lib/validations/email-check'
import { auditFromApiKey, logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', data: null, meta: {} }, { status: 400 })
    }

    const parsed = v1EmailCheckSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', data: null, meta: { details: parsed.error.flatten() } },
        { status: 400 },
      )
    }

    const { fromEmail, helloName } = await getEmailVerifySmtpIdentity()
    const result = await checkEmail({
      to_email: parsed.data.to_email.trim().toLowerCase(),
      from_email: fromEmail,
      hello_name: helloName,
      check_gravatar: parsed.data.check_gravatar ?? false,
    })

    const verdict = result.is_reachable
    const undeliverable = verdict === 'invalid' || verdict === 'risky'

    await logAudit(
      auditFromApiKey(req, auth),
      'email.check',
      { type: 'api', id: null },
      { to_email: parsed.data.to_email, verdict },
    )

    return NextResponse.json({
      data: {
        result,
        verdict,
        undeliverable,
      },
      meta: {},
      error: null,
    })
  })
}
