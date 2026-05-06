function getBaseUrl(): string | null {
  const base = process.env.EMAIL_CHECKER_BASE_URL?.trim()
  if (!base) return null
  return base.replace(/\/$/, '')
}

function getApiSecret(): string | null {
  const secret = process.env.EMAIL_CHECKER_API_SECRET?.trim()
  if (!secret) return null
  return secret
}

export async function runEmailCheckerStartupSelfCheck(service: 'web' | 'worker'): Promise<void> {
  const base = getBaseUrl()
  if (!base) {
    console.warn(`[startup:${service}] EMAIL_CHECKER_BASE_URL is not set, skipping checker health check`)
    return
  }
  const apiSecret = getApiSecret()
  if (!apiSecret) {
    console.warn(`[startup:${service}] EMAIL_CHECKER_API_SECRET is not set, skipping checker health check`)
    return
  }

  const timeoutRaw = parseInt(process.env.EMAIL_CHECKER_TIMEOUT_MS || '30000', 10)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(timeoutRaw, 30000) : 30000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = { 'x-api-secret': apiSecret }

  try {
    const response = await fetch(`${base}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.warn(
        `[startup:${service}] checker health check failed: status=${response.status} base=${base} body=${body.slice(0, 200)}`,
      )
      return
    }

    console.info(`[startup:${service}] checker health check passed: base=${base}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[startup:${service}] checker health check failed: base=${base} error=${msg}`)
  } finally {
    clearTimeout(timer)
  }
}
