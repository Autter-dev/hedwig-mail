import * as IsEmail from 'isemail'
import type { SyntaxDetails } from './types'
import { levenshtein } from './util'

const MAIL_PROVIDERS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'protonmail.com',
  'icloud.com',
  'yandex.com',
]

function normalizeEmail(username: string, domain: string): string {
  const d = String(domain || '').toLowerCase()

  if (d === 'gmail.com' || d === 'googlemail.com') {
    const local = String(username || '')
      .split('+')[0]
      .toLowerCase()
      .replace(/\./g, '')
    return `${local}@gmail.com`
  }

  return `${username}@${domain}`
}

function invalidSyntaxDetails(): SyntaxDetails {
  return {
    address: null,
    domain: '',
    is_valid_syntax: false,
    username: '',
    normalized_email: null,
    suggestion: null,
  }
}

export function checkSyntax(emailAddress: string): SyntaxDetails {
  const email = String(emailAddress || '').trim()
  const isValid = IsEmail.validate(email, { allowUnicode: true })

  if (!isValid) {
    return invalidSyntaxDetails()
  }

  const parts = email.split('@')
  const username = parts[0] ?? ''
  const domain = parts[1] ?? ''
  if (!username || !domain) {
    return invalidSyntaxDetails()
  }

  return {
    address: email,
    domain,
    is_valid_syntax: true,
    username,
    normalized_email: normalizeEmail(username, domain),
    suggestion: null,
  }
}

export function getSimilarMailProvider(syntax: SyntaxDetails | null): void {
  if (!syntax || !syntax.domain || !syntax.username) {
    return
  }

  const domain = String(syntax.domain).toLowerCase()
  for (const provider of MAIL_PROVIDERS) {
    if (levenshtein(domain, provider) < 3) {
      syntax.suggestion = `${syntax.username}@${provider}`
      return
    }
  }
}
