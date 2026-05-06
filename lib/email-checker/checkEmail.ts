import { checkSyntax, getSimilarMailProvider } from './syntax'
import { checkMx } from './mx'
import { checkMisc } from './misc'
import { Rule, hasRule } from './rules'
import { buildDefaultSmtpDetails, checkSmtp } from './smtp'
import { providerFromMx } from './provider'
import { durationFromMs } from './util'
import type { CheckEmailInput, CheckEmailResult, MiscDetails, ReachableVerdict } from './types'

function defaultMisc(): MiscDetails {
  return {
    is_disposable: false,
    is_role_account: false,
    is_b2c: false,
    gravatar_url: null,
    haveibeenpwned: null,
  }
}

function defaultMx() {
  return {
    accepts_mail: false,
    records: [] as string[],
  }
}

function calculateReachable(
  misc: MiscDetails,
  smtpValue: { is_catch_all: boolean; has_full_inbox: boolean; is_deliverable: boolean; is_disabled: boolean; can_connect_smtp: boolean },
  smtpError: boolean,
): ReachableVerdict {
  if (smtpError) {
    return 'unknown'
  }

  if (misc.is_disposable || misc.is_role_account || smtpValue.is_catch_all || smtpValue.has_full_inbox) {
    return 'risky'
  }

  if (!smtpValue.is_deliverable || !smtpValue.can_connect_smtp || smtpValue.is_disabled) {
    return 'invalid'
  }

  return 'safe'
}

function resolveSmtpTimeoutMs(input: CheckEmailInput, hasTimeoutRule: boolean): number {
  let timeoutMs: number

  if (typeof input.smtp_timeout_ms === 'number') {
    timeoutMs = input.smtp_timeout_ms
  } else if (typeof input.smtp_timeout === 'number') {
    timeoutMs = input.smtp_timeout * 1000
  } else {
    const envMs = parseInt(process.env.EMAIL_VERIFY_SMTP_TIMEOUT_MS || '15000', 10)
    timeoutMs = Number.isFinite(envMs) ? envMs : 15000
  }

  if (hasTimeoutRule) {
    timeoutMs = Math.max(timeoutMs, 45000)
  }

  return timeoutMs
}

function chosenMethodForProvider(provider: string, input: CheckEmailInput): string {
  if (provider === 'yahoo') {
    return input.yahoo_verif_method || 'smtp'
  }

  if (provider === 'hotmailb2c') {
    return input.hotmailb2c_verif_method || 'smtp'
  }

  return 'smtp'
}

export async function checkEmail(rawInput: CheckEmailInput = { to_email: '' }): Promise<CheckEmailResult> {
  const startTimeMs = Date.now()
  const startTime = new Date(startTimeMs)

  const envRetries = parseInt(process.env.EMAIL_VERIFY_RETRIES || '1', 10)
  const envPort = parseInt(process.env.EMAIL_VERIFY_SMTP_PORT || '25', 10)

  const backendName = rawInput.backend_name || process.env.EMAIL_VERIFY_BACKEND_NAME || 'hedwig-mail'
  const fromEmail =
    rawInput.from_email ||
    process.env.EMAIL_VERIFY_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    'noreply@localhost'
  const helloName = rawInput.hello_name || process.env.EMAIL_VERIFY_HELLO_NAME || 'localhost'
  const smtpPort = Number(rawInput.smtp_port || envPort || 25)
  const retries = Number(rawInput.retries ?? (Number.isFinite(envRetries) ? envRetries : 1))
  const haveibeenpwnedApiKey =
    rawInput.haveibeenpwned_api_key ?? process.env.WQ_HIBP_API_KEY ?? process.env.HIBP_API_KEY ?? null

  const input = {
    to_email: String(rawInput.to_email || '').trim(),
    from_email: fromEmail,
    hello_name: helloName,
    smtp_port: smtpPort,
    retries,
    proxy: rawInput.proxy || null,
    check_gravatar: Boolean(rawInput.check_gravatar),
    haveibeenpwned_api_key: haveibeenpwnedApiKey,
    backend_name: backendName,
    smtp_timeout_ms: rawInput.smtp_timeout_ms,
    smtp_timeout: rawInput.smtp_timeout,
    yahoo_verif_method: rawInput.yahoo_verif_method || null,
    hotmailb2c_verif_method: rawInput.hotmailb2c_verif_method || null,
  }

  const syntax = checkSyntax(input.to_email)
  if (!syntax.is_valid_syntax) {
    const endTime = new Date()
    return {
      input: input.to_email,
      is_reachable: 'invalid',
      misc: defaultMisc(),
      mx: defaultMx(),
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: 'skipped',
          },
        },
      },
    }
  }

  const misc = await checkMisc(syntax, {
    check_gravatar: input.check_gravatar,
    haveibeenpwned_api_key: input.haveibeenpwned_api_key,
  })

  let mxResult: Awaited<ReturnType<typeof checkMx>>
  try {
    mxResult = await checkMx(syntax.domain)
  } catch (err: unknown) {
    getSimilarMailProvider(syntax)
    const endTime = new Date()
    return {
      input: input.to_email,
      is_reachable: 'unknown',
      misc,
      mx: {
        error: {
          type:
            typeof err === 'object' && err !== null && 'code' in err
              ? String((err as NodeJS.ErrnoException).code)
              : err instanceof Error
                ? err.name
                : 'MxError',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: 'skipped',
          },
        },
      },
    }
  }

  if (!mxResult.accepts_mail || !mxResult.preferred) {
    getSimilarMailProvider(syntax)
    const endTime = new Date()
    return {
      input: input.to_email,
      is_reachable: 'invalid',
      misc,
      mx: {
        accepts_mail: false,
        records: mxResult.records,
      },
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: 'skipped',
          },
        },
      },
    }
  }

  const mxHost = mxResult.preferred.exchange
  const hasTimeoutRule = hasRule(syntax.domain, mxHost, Rule.SMTP_TIMEOUT_45S)

  const provider = providerFromMx(mxHost)
  const chosenMethod = chosenMethodForProvider(provider, input)

  const smtpResult = await checkSmtp({
    toEmail: syntax.address!,
    mxHost,
    domain: syntax.domain,
    smtpPort: input.smtp_port,
    smtpTimeoutMs: resolveSmtpTimeoutMs(input as CheckEmailInput, hasTimeoutRule),
    helloName: input.hello_name,
    fromEmail: input.from_email,
    retries: input.retries,
    provider,
    chosenMethod,
  })

  if (smtpResult.smtpError) {
    getSimilarMailProvider(syntax)
  }

  const endTime = new Date()
  const debugSmtp = smtpResult.debug || {
    verif_method: {
      type: 'skipped',
    },
  }

  if (chosenMethod !== 'smtp') {
    debugSmtp.verif_method = {
      ...debugSmtp.verif_method,
      requested_method: chosenMethod,
      fallback_to: 'smtp',
    }
  }

  const smtpErrorBool = Boolean(smtpResult.smtpError)

  return {
    input: input.to_email,
    is_reachable: calculateReachable(misc, smtpResult.smtp, smtpErrorBool),
    misc,
    mx: {
      accepts_mail: mxResult.accepts_mail,
      records: mxResult.records,
    },
    smtp: smtpResult.smtpError || smtpResult.smtp,
    syntax,
    debug: {
      backend_name: input.backend_name,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration: durationFromMs(endTime.getTime() - startTimeMs),
      smtp: debugSmtp,
    },
  }
}
