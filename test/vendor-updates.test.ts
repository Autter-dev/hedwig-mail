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

test('vendor updates: pg-boss 12.39 and posthog-node 6 drop unreadable events', async () => {
  assert.ok(
    atLeast(dependencyVersion('pg-boss'), [12, 39, 0]),
    'pg-boss must be at least 12.39.0',
  )
  assert.ok(
    atLeast(dependencyVersion('posthog-node'), [6, 0, 0]),
    'posthog-node must be at least 6.0.0',
  )

  const client = new PostHog('phc_test_key', {
    host: 'http://127.0.0.1:1',
    fetch: async () => ({
      status: 200,
      text: async () => '',
      json: async () => ({ results: {} }),
    }),
  })

  // A property that throws when read makes the event unserializable. posthog-node 6
  // drops the event locally instead of rejecting or throwing from either capture lane.
  const unreadable: Record<string, unknown> = {}
  Object.defineProperty(unreadable, 'value', {
    enumerable: true,
    get() {
      throw new Error('unreadable property')
    },
  })

  try {
    await assert.doesNotReject(async () => {
      await client.captureImmediate({
        distinctId: 'test',
        event: 'test_event',
        properties: unreadable,
      })
    })
    await assert.doesNotReject(async () => {
      await client.captureAiImmediate({
        distinctId: 'test',
        event: '$ai_test_event',
        properties: unreadable,
      })
    })
  } finally {
    await client.shutdown(100).catch(() => undefined)
  }
})
