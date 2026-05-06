export type ReachableVerdict = 'safe' | 'invalid' | 'risky' | 'unknown'

export interface SyntaxDetails {
  address: string | null
  domain: string
  is_valid_syntax: boolean
  username: string
  normalized_email: string | null
  suggestion: string | null
}

export interface MiscDetails {
  is_disposable: boolean
  is_role_account: boolean
  is_b2c: boolean
  gravatar_url: string | null
  haveibeenpwned: boolean | null
}

export interface MxError {
  type: string
  message: string
}

export interface SmtpErrorShape {
  error: {
    type: string
    message: string
  }
  description?: string
}

export interface SmtpDetails {
  can_connect_smtp: boolean
  has_full_inbox: boolean
  is_catch_all: boolean
  is_deliverable: boolean
  is_disabled: boolean
}

export interface CheckEmailDebug {
  backend_name: string
  start_time: string
  end_time: string
  duration: { secs: number; nanos: number }
  smtp: {
    verif_method: {
      type: string
      host?: string
      smtp_port?: number
      provider?: string
      method?: string
      requested_method?: string
      fallback_to?: string
    }
  }
}

export interface CheckEmailResult {
  input: string
  is_reachable: ReachableVerdict
  misc: MiscDetails
  mx:
    | {
        accepts_mail: boolean
        records: string[]
      }
    | {
        error: MxError
      }
    | {
        accepts_mail: false
        records: string[]
      }
  smtp: SmtpDetails | SmtpErrorShape
  syntax: SyntaxDetails
  debug: CheckEmailDebug
}

export interface CheckEmailInput {
  to_email: string
  from_email?: string
  hello_name?: string
  smtp_port?: number
  retries?: number
  proxy?: unknown
  check_gravatar?: boolean
  haveibeenpwned_api_key?: string | null
  backend_name?: string
  smtp_timeout_ms?: number
  smtp_timeout?: number
  yahoo_verif_method?: string | null
  hotmailb2c_verif_method?: string | null
}
