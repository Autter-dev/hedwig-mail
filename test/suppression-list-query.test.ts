import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSuppressionListQuery } from '@/lib/suppressions/list-query'

const parse = (qs: string) => parseSuppressionListQuery(new URLSearchParams(qs))

describe('parseSuppressionListQuery', () => {
  it('defaults to the first page of 50 with no filters', () => {
    assert.deepEqual(parse(''), { ok: true, query: { page: 1, limit: 50, search: '', reason: null } })
  })

  it('accepts a known reason, case-insensitively, and "all" as no filter', () => {
    assert.deepEqual(parse('reason=Bounce'), { ok: true, query: { page: 1, limit: 50, search: '', reason: 'bounce' } })
    assert.deepEqual(parse('reason=all'), { ok: true, query: { page: 1, limit: 50, search: '', reason: null } })
  })

  it('rejects an unknown reason instead of returning everything', () => {
    const parsed = parse('reason=bounced')
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.match(parsed.error, /Unknown reason "bounced"/)
  })

  it('clamps page and limit and trims the search', () => {
    assert.deepEqual(parse('page=-3&limit=999&search=%20a%40b.com%20'), {
      ok: true,
      query: { page: 1, limit: 200, search: 'a@b.com', reason: null },
    })
  })
})
