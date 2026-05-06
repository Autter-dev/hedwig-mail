import { createConnection, type Socket as NetSocket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { randomBytes } from 'node:crypto'
import { Rule, hasRule, normalizeMxHost } from './rules'
import {
  isDisabledAccountError,
  isFullInboxError,
  isInvalidError,
  isIpBlacklistedError,
  isNeedsRdnsError,
} from './smtpParser'
import type { SmtpDetails, SmtpErrorShape } from './types'

function toSmtpError(type: string, message: string, description?: string): SmtpErrorShape {
  return {
    error: {
      type,
      message,
    },
    ...(description ? { description } : {}),
  }
}

export function buildDefaultSmtpDetails(): SmtpDetails {
  return {
    can_connect_smtp: false,
    has_full_inbox: false,
    is_catch_all: false,
    is_deliverable: false,
    is_disabled: false,
  }
}

type SmtpSocket = NetSocket | TLSSocket

function createLineReader(socket: SmtpSocket) {
  let buffer = ''
  let ended = false
  const queue: string[] = []
  const waiters: Array<{
    resolve: (line: string) => void
    reject: (err: Error) => void
  }> = []

  function pushLine(line: string) {
    if (waiters.length > 0) {
      const waiter = waiters.shift()!
      waiter.resolve(line)
    } else {
      queue.push(line)
    }
  }

  function failAll(err: Error) {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!
      waiter.reject(err)
    }
  }

  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      pushLine(line)
      idx = buffer.indexOf('\n')
    }
  })

  socket.on('end', () => {
    ended = true
    failAll(new Error('SMTP socket ended'))
  })

  socket.on('error', () => {
    ended = true
    failAll(new Error('SMTP socket error'))
  })

  async function readLine(timeoutMs: number): Promise<string> {
    if (queue.length > 0) {
      return queue.shift()!
    }

    if (ended) {
      throw new Error('SMTP socket closed')
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve)
        if (idx >= 0) {
          waiters.splice(idx, 1)
        }
        reject(new Error('SMTP read timeout'))
      }, timeoutMs)

      waiters.push({
        resolve: (line) => {
          clearTimeout(timer)
          resolve(line)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  return { readLine }
}

async function readResponse(reader: { readLine: (ms: number) => Promise<string> }, timeoutMs: number) {
  const firstLine = await reader.readLine(timeoutMs)
  if (!/^\d{3}[\s-]/.test(firstLine)) {
    return {
      code: 0,
      lines: [firstLine],
      message: firstLine,
      success: false,
    }
  }

  const code = Number(firstLine.slice(0, 3))
  const lines = [firstLine.slice(4).trim()]
  let separator = firstLine[3]

  while (separator === '-') {
    const line = await reader.readLine(timeoutMs)
    if (/^\d{3}[\s-]/.test(line)) {
      separator = line[3]
      lines.push(line.slice(4).trim())
      if (Number(line.slice(0, 3)) !== code) {
        break
      }
    } else {
      separator = ' '
      lines.push(line.trim())
    }
  }

  return {
    code,
    lines,
    message: lines.join('; '),
    success: code >= 200 && code < 400,
  }
}

async function connectSocket(host: string, port: number, timeoutMs: number): Promise<SmtpSocket> {
  if (port === 465) {
    return tlsConnect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })
  }

  return createConnection({ host, port, timeout: timeoutMs })
}

type ClassifyResult =
  | { error: SmtpErrorShape }
  | {
      deliverability: {
        has_full_inbox: boolean
        is_deliverable: boolean
        is_disabled: boolean
      }
    }

function classifySmtpErrorMessage(message: string, toEmail: string): ClassifyResult {
  const lower = String(message || '').toLowerCase()

  if (isDisabledAccountError(lower)) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: false,
        is_disabled: true,
      },
    }
  }

  if (isFullInboxError(lower)) {
    return {
      deliverability: {
        has_full_inbox: true,
        is_deliverable: false,
        is_disabled: false,
      },
    }
  }

  if (lower.includes('the user you are trying to contact is receiving mail at a rate that')) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: true,
        is_disabled: false,
      },
    }
  }

  if (isInvalidError(lower, toEmail)) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: false,
        is_disabled: false,
      },
    }
  }

  if (isIpBlacklistedError(lower)) {
    return {
      error: toSmtpError('SmtpError', message, 'IpBlacklisted'),
    }
  }

  if (isNeedsRdnsError(lower)) {
    return {
      error: toSmtpError('SmtpError', message, 'NeedsRDNS'),
    }
  }

  return {
    error: toSmtpError('SmtpError', message),
  }
}

async function sendCommand(socket: SmtpSocket, reader: ReturnType<typeof createLineReader>, cmd: string, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${cmd}\r\n`, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  return readResponse(reader, timeoutMs)
}

export interface CheckSmtpConfig {
  toEmail: string
  mxHost: string
  domain: string
  smtpPort: number
  smtpTimeoutMs: number
  helloName: string
  fromEmail: string
  retries: number
  provider: string
  chosenMethod: string
}

export interface CheckSmtpResult {
  smtp: SmtpDetails
  smtpError: SmtpErrorShape | null
  debug: {
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

async function checkSmtpOnce(input: CheckSmtpConfig): Promise<CheckSmtpResult> {
  const {
    toEmail,
    mxHost,
    domain,
    smtpPort,
    smtpTimeoutMs,
    helloName,
    fromEmail,
    provider,
    chosenMethod,
  } = input

  const cleanHost = String(mxHost || '').replace(/\.$/, '')
  const socket = await connectSocket(cleanHost, smtpPort, smtpTimeoutMs)
  socket.setTimeout(smtpTimeoutMs, () => {
    socket.destroy(new Error('SMTP timeout'))
  })

  const reader = createLineReader(socket)

  try {
    const greeting = await readResponse(reader, smtpTimeoutMs)
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting: ${greeting.message}`)
    }

    const ehlo = await sendCommand(socket, reader, `EHLO ${helloName}`, smtpTimeoutMs)
    if (!(ehlo.code >= 200 && ehlo.code < 300)) {
      throw new Error(`EHLO failed: ${ehlo.message}`)
    }

    const mailFrom = await sendCommand(socket, reader, `MAIL FROM:<${fromEmail}>`, smtpTimeoutMs)
    if (!(mailFrom.code >= 200 && mailFrom.code < 300)) {
      throw new Error(`MAIL FROM failed: ${mailFrom.message}`)
    }

    let isCatchAll = false
    const shouldSkipCatchAll = hasRule(domain, mxHost, Rule.SKIP_CATCH_ALL)

    if (!shouldSkipCatchAll) {
      const randomEmail = `${randomBytes(8).toString('hex')}@${domain}`
      const randomRcpt = await sendCommand(socket, reader, `RCPT TO:<${randomEmail}>`, smtpTimeoutMs)
      isCatchAll = randomRcpt.code === 250 || randomRcpt.code === 251
    }

    let deliverability: {
      has_full_inbox: boolean
      is_deliverable: boolean
      is_disabled: boolean
    }

    if (isCatchAll) {
      deliverability = {
        has_full_inbox: false,
        is_deliverable: true,
        is_disabled: false,
      }
    } else {
      const rcpt = await sendCommand(socket, reader, `RCPT TO:<${toEmail}>`, smtpTimeoutMs)

      if (rcpt.code === 250 || rcpt.code === 251) {
        deliverability = {
          has_full_inbox: false,
          is_deliverable: true,
          is_disabled: false,
        }
      } else {
        const parsed = classifySmtpErrorMessage(rcpt.message, toEmail)
        if ('error' in parsed) {
          return {
            smtp: buildDefaultSmtpDetails(),
            smtpError: parsed.error,
            debug: {
              verif_method: {
                type: 'smtp',
                host: normalizeMxHost(mxHost),
                smtp_port: smtpPort,
                provider,
                method: chosenMethod || 'smtp',
              },
            },
          }
        }
        deliverability = parsed.deliverability
      }
    }

    try {
      await sendCommand(socket, reader, 'QUIT', smtpTimeoutMs)
    } catch {
      // ignore
    }

    return {
      smtp: {
        can_connect_smtp: true,
        has_full_inbox: deliverability.has_full_inbox,
        is_catch_all: isCatchAll,
        is_deliverable: deliverability.is_deliverable,
        is_disabled: deliverability.is_disabled,
      },
      smtpError: null,
      debug: {
        verif_method: {
          type: 'smtp',
          host: normalizeMxHost(mxHost),
          smtp_port: smtpPort,
          provider,
          method: chosenMethod || 'smtp',
        },
      },
    }
  } finally {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }
}

export async function checkSmtp(config: CheckSmtpConfig): Promise<CheckSmtpResult> {
  const retries = Math.max(1, Number(config.retries || 1))

  let lastResult: CheckSmtpResult | null = null
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await checkSmtpOnce(config)
      if (!result.smtpError) {
        return result
      }

      lastResult = result
      if (result.smtpError.description || attempt === retries) {
        return result
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const description = isIpBlacklistedError(message)
        ? 'IpBlacklisted'
        : isNeedsRdnsError(message)
          ? 'NeedsRDNS'
          : undefined

      lastResult = {
        smtp: buildDefaultSmtpDetails(),
        smtpError: toSmtpError('ConnectionError', message, description),
        debug: {
          verif_method: {
            type: 'smtp',
            host: normalizeMxHost(config.mxHost),
            smtp_port: config.smtpPort,
            provider: config.provider,
            method: config.chosenMethod || 'smtp',
          },
        },
      }

      if (description || attempt === retries) {
        return lastResult
      }
    }
  }

  return (
    lastResult || {
      smtp: buildDefaultSmtpDetails(),
      smtpError: toSmtpError('Unknown', 'Unknown SMTP error'),
      debug: {
        verif_method: {
          type: 'smtp',
          host: normalizeMxHost(config.mxHost),
          smtp_port: config.smtpPort,
          provider: config.provider,
          method: config.chosenMethod || 'smtp',
        },
      },
    }
  )
}
