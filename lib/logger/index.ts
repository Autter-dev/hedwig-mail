import pino from 'pino'
import { PostHog } from 'posthog-node'

const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

// Use synchronous stdout destination to avoid pino's worker thread transport,
// which breaks inside Next.js webpack-bundled server code.
export const logger = pino({
  level: LOG_LEVEL,
}, pino.destination(1))

let posthogClient: PostHog | null = null

function getPostHog(): PostHog | null {
  if (posthogClient) return posthogClient
  const apiKey = process.env.POSTHOG_API_KEY
  const host = process.env.POSTHOG_HOST
  if (!apiKey || !host) return null
  try {
    posthogClient = new PostHog(apiKey, { host, flushAt: 10, flushInterval: 5000 })
    logger.info({ host }, 'PostHog tracking initialized')
    return posthogClient
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize PostHog, falling back to local logging only')
    return null
  }
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  const ph = getPostHog()
  if (ph) {
    try {
      void ph.captureImmediate({ distinctId: 'hedwig-mail-server', event, properties })
        .catch((err) => logger.warn({ err, event }, 'Failed to send event to PostHog'))
    } catch (err) {
      logger.warn({ err, event }, 'Failed to send event to PostHog')
    }
  }
}

export function trackError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  const ph = getPostHog()
  if (ph) {
    try {
      void ph.captureImmediate({
        distinctId: 'hedwig-mail-server',
        event: 'server_error',
        properties: { error_message: message, error_stack: stack, ...context },
      }).catch((err) => logger.warn({ err }, 'Failed to send error to PostHog'))
    } catch (err) {
      logger.warn({ err }, 'Failed to send error to PostHog')
    }
  }
  logger.error({ err: { message, stack }, ...context }, message)
}

export async function shutdownTracking() {
  if (posthogClient) {
    try {
      await posthogClient.shutdown()
    } catch {
      // ignore shutdown errors
    }
  }
}
