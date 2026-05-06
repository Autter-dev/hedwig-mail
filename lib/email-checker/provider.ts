export function isGmail(mxHost: string): boolean {
  return String(mxHost || '').toLowerCase().endsWith('.google.com.')
}

export function isHotmail(mxHost: string): boolean {
  return String(mxHost || '').toLowerCase().endsWith('.protection.outlook.com.')
}

export function isHotmailB2B(mxHost: string): boolean {
  const host = String(mxHost || '').toLowerCase()
  return isHotmail(host) && !host.endsWith('.olc.protection.outlook.com.')
}

export function isHotmailB2C(mxHost: string): boolean {
  const host = String(mxHost || '').toLowerCase()
  return isHotmail(host) && host.endsWith('.olc.protection.outlook.com.')
}

export function isMimecast(mxHost: string): boolean {
  return String(mxHost || '').toLowerCase().endsWith('.mimecast.com.')
}

export function isProofpoint(mxHost: string): boolean {
  const host = String(mxHost || '').toLowerCase()
  return host.endsWith('.pphosted.com.') || host.endsWith('ppe-hosted.com.')
}

export function isYahoo(mxHost: string): boolean {
  return String(mxHost || '').toLowerCase().endsWith('.yahoodns.net.')
}

export function providerFromMx(mxHost: string): string {
  if (isHotmailB2C(mxHost)) return 'hotmailb2c'
  if (isHotmailB2B(mxHost)) return 'hotmailb2b'
  if (isGmail(mxHost)) return 'gmail'
  if (isYahoo(mxHost)) return 'yahoo'
  if (isProofpoint(mxHost)) return 'proofpoint'
  if (isMimecast(mxHost)) return 'mimecast'
  return 'everything_else'
}
