import { resolveMx } from 'node:dns/promises'
import { normalizeMxHost } from './rules'

function getMxErrorType(err: unknown): string {
  if (!err) return 'UnknownError'
  if (typeof err === 'object' && err !== null && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string') {
    return (err as NodeJS.ErrnoException).code!
  }
  if (err instanceof Error) return err.name || 'Error'
  return 'Error'
}

export interface MxResult {
  accepts_mail: boolean
  records: string[]
  preferred: { exchange: string; priority: number } | null
  lookupError: { type: string; message: string } | null
}

export async function checkMx(domain: string): Promise<MxResult> {
  try {
    const mxRecords = await resolveMx(domain)
    const sorted = mxRecords
      .map((x) => ({ exchange: normalizeMxHost(x.exchange), priority: x.priority }))
      .sort((a, b) => a.priority - b.priority)

    return {
      accepts_mail: sorted.length > 0,
      records: sorted.map((x) => x.exchange),
      preferred: sorted[0] || null,
      lookupError: null,
    }
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as NodeJS.ErrnoException).code : ''
    if (['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'SERVFAIL'].includes(String(code))) {
      return {
        accepts_mail: false,
        records: [],
        preferred: null,
        lookupError: {
          type: getMxErrorType(err),
          message: err instanceof Error ? err.message : 'No MX records',
        },
      }
    }

    throw err
  }
}
