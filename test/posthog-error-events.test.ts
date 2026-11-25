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

test('posthog-node 6.0.6: the server logger observes delivery failures on the error event', async () => {
  assert.ok(
    atLeast(dependencyVersion('posthog-node'), [6, 0, 6]),
    'posthog-node must be at least 6.0.6',
  )

  const savedApiKey = process.env.POSTHOG_API_KEY
  const savedHost = process.env.POSTHOG_HOST
  process.env.POSTHOG_API_KEY = 'phc_synthetic_test_key'
  process.env.POSTHOG_HOST = 'https://posthog.invalid'

  // posthog-node 6 sends delivery failures to the client's 'error' event instead
  // of rejecting captureImmediate(), so the logger has to subscribe to it.
  const originalOn = PostHog.prototype.on
  let deliveryFailures = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(PostHog.prototype as any).on = function (
    event: string,
    listener: (...args: unknown[]) => void,
  ) {
    if (event !== 'error') return originalOn.call(this, event, listener)
    return originalOn.call(this, event, (...args: unknown[]) => {
      deliveryFailures += 1
      listener(...args)
    })
  }

  try {
    const loggerModule = await import('../lib/logger/index')

    // A property that throws when read makes the event unserializable. posthog-node
    // drops it locally and reports the drop through 'error' without any network I/O.
    const unreadable: Record<string, unknown> = {}
    Object.defineProperty(unreadable, 'value', {
      enumerable: true,
      get() {
        throw new Error('unreadable property')
      },
    })

    loggerModule.trackEvent('synthetic_event', unreadable)
    await loggerModule.shutdownTracking()
  } finally {
    ;(PostHog.prototype as any).on = originalOn
    if (savedApiKey === undefined) delete process.env.POSTHOG_API_KEY
    else process.env.POSTHOG_API_KEY = savedApiKey
    if (savedHost === undefined) delete process.env.POSTHOG_HOST
    else process.env.POSTHOG_HOST = savedHost
  }

  assert.equal(deliveryFailures, 1, 'the logger must receive the delivery failure')
})
