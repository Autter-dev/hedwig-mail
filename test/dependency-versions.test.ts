import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(repoRoot, name), 'utf8')) as T
}

type PackageLock = {
  packages: Record<string, { version?: string }>
}

describe('dependency versions', () => {
  it('pins glob to the patched 10.5.0 release', () => {
    const manifest = readJson<{ overrides?: Record<string, unknown> }>('package.json')
    assert.equal(
      manifest.overrides?.glob,
      '10.5.0',
      'package.json must override glob to the patched 10.5.0 release',
    )

    const lock = readJson<PackageLock>('package-lock.json')
    const globEntries = Object.entries(lock.packages).filter(
      ([path]) => path === 'node_modules/glob' || path.endsWith('/node_modules/glob'),
    )
    assert.ok(globEntries.length > 0, 'expected glob to be present in package-lock.json')

    for (const [path, pkg] of globEntries) {
      assert.equal(pkg.version, '10.5.0', `${path} must resolve to glob 10.5.0`)
    }
  })
})
