import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValid as mailcheckerIsValid } from 'mailchecker'
import disposableEmailDomains from 'disposable-email-domains'
import type { MiscDetails, SyntaxDetails } from './types'

const dataDir = join(process.cwd(), 'lib/email-checker/data')

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const rolesSet = new Set(readLines(join(dataDir, 'roles.txt')).map((x) => x.toLowerCase()))
const b2cSet = new Set(readLines(join(dataDir, 'b2c.txt')).map((x) => x.toLowerCase()))

const manualDisposableDomains = new Set([
  'tempmail.com',
  'temp-mail.org',
  'tempmail.org',
  'yopmail.com',
])

const disposableDomainSet = new Set(
  (disposableEmailDomains as string[]).map((domain) => String(domain).toLowerCase()),
)

function isDisposableDomain(domain: string): boolean {
  let candidate = String(domain || '').toLowerCase().trim()
  if (!candidate) {
    return false
  }

  while (candidate.includes('.')) {
    if (disposableDomainSet.has(candidate) || manualDisposableDomains.has(candidate)) {
      return true
    }
    candidate = candidate.slice(candidate.indexOf('.') + 1)
  }

  return disposableDomainSet.has(candidate) || manualDisposableDomains.has(candidate)
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

async function checkGravatar(email: string): Promise<string | null> {
  const hash = createHash('md5').update(String(email)).digest('hex')
  const url = `https://www.gravatar.com/avatar/${hash}`

  try {
    const response = await fetchWithTimeout(`${url}?d=404`, {}, 6000)
    return response.status === 200 ? url : null
  } catch {
    return null
  }
}

async function checkHaveIBeenPwned(email: string, apiKey: string | null): Promise<boolean | null> {
  if (!apiKey) {
    return null
  }

  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(
    email,
  )}?truncateResponse=false`

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': 'hedwig-mail-email-checker',
          'hibp-api-key': apiKey,
        },
      },
      10000,
    )

    if (response.ok) {
      const breaches = (await response.json()) as unknown
      return Array.isArray(breaches) ? breaches.length > 0 : false
    }

    if (response.status === 404) {
      return false
    }

    return null
  } catch {
    return null
  }
}

export interface CheckMiscOptions {
  check_gravatar?: boolean
  haveibeenpwned_api_key?: string | null
}

export async function checkMisc(syntax: SyntaxDetails, options: CheckMiscOptions = {}): Promise<MiscDetails> {
  const email = syntax.address!
  const username = String(syntax.username || '').toLowerCase()
  const domain = String(syntax.domain || '').toLowerCase()

  const [gravatarUrl, hibp] = await Promise.all([
    options.check_gravatar ? checkGravatar(email) : Promise.resolve(null),
    options.haveibeenpwned_api_key
      ? checkHaveIBeenPwned(email, options.haveibeenpwned_api_key)
      : Promise.resolve(null),
  ])

  return {
    is_disposable: !mailcheckerIsValid(email) || isDisposableDomain(domain),
    is_role_account: rolesSet.has(username),
    is_b2c: b2cSet.has(domain),
    gravatar_url: gravatarUrl,
    haveibeenpwned: hibp,
  }
}
