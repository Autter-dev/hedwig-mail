import rules from './data/rules.json'

export const Rule = {
  SKIP_CATCH_ALL: 'SkipCatchAll',
  SMTP_TIMEOUT_45S: 'SmtpTimeout45s',
} as const

type RulesFile = {
  by_domain?: Record<string, { rules?: string[] }>
  by_mx?: Record<string, { rules?: string[] }>
  by_mx_suffix?: Record<string, { rules?: string[] }>
}

const rulesData = rules as RulesFile

function hasRuleByDomain(domain: string, rule: string): boolean {
  return Boolean(rulesData.by_domain?.[domain]?.rules?.includes(rule))
}

function hasRuleByMx(host: string, rule: string): boolean {
  return Boolean(rulesData.by_mx?.[host]?.rules?.includes(rule))
}

function hasRuleByMxSuffix(host: string, rule: string): boolean {
  const suffixMap = rulesData.by_mx_suffix || {}
  for (const [suffix, value] of Object.entries(suffixMap)) {
    if (host.endsWith(suffix) && value?.rules?.includes(rule)) return true
  }
  return false
}

export function normalizeMxHost(host: string): string {
  const h = String(host || '').toLowerCase()
  return h.endsWith('.') ? h : `${h}.`
}

export function hasRule(domain: string, mxHost: string, rule: string): boolean {
  const d = String(domain || '').toLowerCase()
  const h = normalizeMxHost(mxHost)
  return hasRuleByDomain(d, rule) || hasRuleByMx(h, rule) || hasRuleByMxSuffix(h, rule)
}
