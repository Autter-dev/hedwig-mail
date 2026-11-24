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

test('posthog-node 6.0.6: the server logger sends only the events it is handed', async () => {
  assert.ok(
    atLeast(dependencyVersion('posthog-node'), [6, 0, 6]),
    'posthog-node must be at least 6.0.6',
  )

  // The upstream heatmaps/dead-clicks change stops the browser SDK from flushing
  // interactions captured while capturing was off. posthog-node has no heatmap or
  // dead-click capture lane, so the server logger must not grow one either.
  const captureSurface = Object.getOwnPropertyNames(PostHog.prototype).filter((name) =>
    /heatmap|dead_?click/i.test(name),
  )
  assert.deepEqual(captureSurface, [], 'posthog-node must not expose a heatmap/dead-click lane')

  delete process.env.POSTHOG_API_KEY
  delete process.env.POSTHOG_HOST

  const loggerModule = await import('../lib/logger/index')

  assert.equal(typeof loggerModule.trackEvent, 'function')
  assert.equal(typeof loggerModule.trackError, 'function')
  for (const exported of Object.keys(loggerModule)) {
    assert.doesNotMatch(
      exported,
      /heatmap|dead_?click/i,
      `unexpected heatmap/dead-click export ${exported}`,
    )
  }

  // With tracking unconfigured the logger stays a local no-op: nothing is batched,
  // so an event captured while capturing is off cannot leak to PostHog later.
  assert.doesNotThrow(() => loggerModule.trackEvent('synthetic_event', { source: 'test' }))
  await loggerModule.shutdownTracking()
})
