import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PostHog } from 'posthog-node'

function dependencyVersion(name: string): number[] {
  const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>
  }
  return dependencies[name].replace(/^\D+/, '').split('.').map(Number)
}

function atLeast(version: number[], minimum: number[]): boolean {
  for (let i = 0; i < Math.max(version.length, minimum.length); i++) {
    const a = version[i] ?? 0
    const b = minimum[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

test('posthog-node 6.1.0: the server logger still captures through captureImmediate', async () => {
  assert.ok(
    atLeast(dependencyVersion('posthog-node'), [6, 1, 0]),
    'posthog-node must be at least 6.1.0',
  )

  const savedApiKey = process.env.POSTHOG_API_KEY
  const savedHost = process.env.POSTHOG_HOST
  process.env.POSTHOG_API_KEY = 'phc_synthetic_test_key'
  process.env.POSTHOG_HOST = 'https://posthog.invalid'

  // 6.x sends analytics events through captureImmediate. Track what the logger
  // hands the SDK so a regression back to the 5.x capture lane is visible.
  const sent: Array<{ event: string; distinctId: string }> = []
  const originalCaptureImmediate = PostHog.prototype.captureImmediate
  PostHog.prototype.captureImmediate = async function (
    message: { event: string; distinctId: string },
  ) {
    sent.push({ event: message.event, distinctId: message.distinctId })
    return undefined
  }

  try {
    const loggerModule = await import('../lib/logger/index')

    loggerModule.trackEvent('synthetic_event', { source: 'test' })
    loggerModule.trackError(new Error('synthetic failure'), { source: 'test' })
    await loggerModule.shutdownTracking()
  } finally {
    PostHog.prototype.captureImmediate = originalCaptureImmediate
    if (savedApiKey === undefined) delete process.env.POSTHOG_API_KEY
    else process.env.POSTHOG_API_KEY = savedApiKey
    if (savedHost === undefined) delete process.env.POSTHOG_HOST
    else process.env.POSTHOG_HOST = savedHost
  }

  assert.deepEqual(
    sent,
    [
      { event: 'synthetic_event', distinctId: 'hedwig-mail-server' },
      { event: 'server_error', distinctId: 'hedwig-mail-server' },
    ],
    'both logger helpers must send exactly one event through captureImmediate',
  )
})
