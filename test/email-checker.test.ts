/**
 * Integration tests for the Email Checker cleanup logic and the cross-list duplicates route.
 *
 * These run against a real Postgres and DELETE DATA in it. They only run when
 * TEST_DATABASE_URL is set, and never read DATABASE_URL, so they cannot touch a
 * real database by accident. Migrations are applied automatically.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hedwig_test npm test
 *
 * Node runs test files in parallel, and every file would share this database, so
 * keep database tests in this file (or run them serially) to avoid clobbering.
 */
// Must be the first import: it points DATABASE_URL at the test database before lib/db loads.
import { skipWithoutDatabase } from './helpers/test-env'
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as orm from 'drizzle-orm'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import * as schema from '@/lib/db/schema'
import * as cleanup from '@/lib/email-verify-cleanup'
import * as queue from '@/lib/queue'
import { runMigrationsWithLock } from '@/lib/db/run-migrations'
import * as crossList from '@/app/api/internal/duplicates/cross-list/route'

// Static imports keep a single instance of lib/db and lib/queue. Dynamic import()
// can load a second copy with its own connection pool, which then never closes.
const m = { db: dbModule, schema, cleanup, queue, orm, crossList, server: { NextRequest } }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// Metadata as the worker writes it after a check.
function checked(verdict: string, at = minutesAgo(60), extra: Record<string, string> = {}) {
  return { _email_verify_reachable: verdict, _email_verify_checked_at: at, ...extra }
}

async function createList(name: string) {
  const [list] = await m.db.db.insert(m.schema.lists).values({ name }).returning()
  return list
}

async function contactByEmailInList(listId: string, email: string) {
  const { contacts } = m.schema
  const { and, eq } = m.orm
  const [row] = await m.db.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.listId, listId), eq(contacts.email, email)))
  return row
}

describe('email checker', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    await runMigrationsWithLock()
  })

  beforeEach(async () => {
    const { sql } = m.orm
    // Contacts cascade to sends and events. pgboss.job exists once a queue has started.
    await m.db.db.execute(sql`delete from contacts; delete from lists; delete from suppressions`)
    await m.db.db.execute(sql`do $$ begin
      if to_regclass('pgboss.job') is not null then delete from pgboss.job; end if;
    end $$`)
  })

  after(async () => {
    // getQueue() starts pg-boss on first use. Stop it so the process can exit.
    await (await m.queue.getQueue()).stop({ graceful: false }).catch(() => {})
    await m.db.pool.end()
  })

  // A list covering every verdict, an unchecked contact, and a bounced contact.
  async function seedList() {
    const list = await createList('Newsletter')
    await m.db.db.insert(m.schema.contacts).values([
      { listId: list.id, email: 'good@a.com', metadata: checked('safe') },
      {
        listId: list.id,
        email: 'bad1@a.com',
        status: 'undeliverable',
        metadata: checked('invalid', minutesAgo(60), {
          _email_verify_smtp_error: JSON.stringify({ type: 'x', message: 'mailbox not found' }),
        }),
      },
      { listId: list.id, email: 'bad2@a.com', status: 'undeliverable', metadata: checked('invalid') },
      { listId: list.id, email: 'catchall@a.com', status: 'undeliverable', metadata: checked('risky') },
      { listId: list.id, email: 'shrug@a.com', metadata: checked('unknown') },
      { listId: list.id, email: 'new1@a.com', metadata: {} },
      { listId: list.id, email: 'new2@a.com', metadata: { _email_verify_checked_at: '  ' } },
      { listId: list.id, email: 'bounced@a.com', status: 'bounced', metadata: checked('invalid') },
    ])
    return list
  }

  describe('getEmailCheckSummary', () => {
    it('counts verdicts for checkable contacts only', async () => {
      const list = await seedList()
      const summary = await m.cleanup.getEmailCheckSummary(list.id)
      assert.deepEqual(summary, {
        total: 7,
        safe: 1,
        risky: 1,
        invalid: 2,
        unknown: 1,
        unchecked: 2,
        inProgress: 0,
        uncheckedIdle: 2,
      })
    })

    it('scopes to one list or covers all lists', async () => {
      const list = await seedList()
      const other = await createList('Other')
      await m.db.db.insert(m.schema.contacts).values([
        { listId: other.id, email: 'bad@b.com', status: 'undeliverable', metadata: checked('invalid') },
      ])
      assert.equal((await m.cleanup.getEmailCheckSummary(list.id)).invalid, 2)
      assert.equal((await m.cleanup.getEmailCheckSummary(other.id)).invalid, 1)
      assert.equal((await m.cleanup.getEmailCheckSummary()).invalid, 3)
    })
  })

  describe('listFlaggedContacts', () => {
    it('filters by verdict and includes list name and SMTP error', async () => {
      const list = await seedList()
      const { data, total } = await m.cleanup.listFlaggedContacts({
        listId: list.id,
        verdicts: ['invalid'],
        page: 1,
        limit: 50,
      })
      assert.equal(total, 2)
      assert.deepEqual(data.map((r) => r.email), ['bad1@a.com', 'bad2@a.com'])
      assert.equal(data[0].listName, 'Newsletter')
      assert.match(data[0].smtpError ?? '', /mailbox not found/)
    })

    it('pages and searches', async () => {
      const list = await seedList()
      const page2 = await m.cleanup.listFlaggedContacts({ listId: list.id, verdicts: ['invalid'], page: 2, limit: 1 })
      assert.equal(page2.total, 2)
      assert.deepEqual(page2.data.map((r) => r.email), ['bad2@a.com'])

      const searched = await m.cleanup.listFlaggedContacts({
        verdicts: ['invalid', 'risky', 'unknown'],
        search: 'catch',
        page: 1,
        limit: 50,
      })
      assert.deepEqual(searched.data.map((r) => r.email), ['catchall@a.com'])
    })
  })

  describe('startEmailCheckRun', () => {
    async function verifyJobCount() {
      const { sql } = m.orm
      const result = await m.db.db.execute(
        sql`select count(*)::int as n from pgboss.job where name = ${m.queue.JOBS.VERIFY_CONTACT_EMAIL}`,
      )
      return (result.rows[0] as { n: number }).n
    }

    it('queues never-checked contacts and marks them in progress', async () => {
      // Regression: never-queued contacts have no _email_verify_queued_at, and a NULL
      // in the in-progress check used to filter every one of them out.
      const list = await seedList()
      const run = await m.cleanup.startEmailCheckRun(list.id, 'unchecked')
      assert.deepEqual(run, { queued: 2, capped: false })
      assert.equal(await verifyJobCount(), 2)

      const summary = await m.cleanup.getEmailCheckSummary(list.id)
      assert.equal(summary.inProgress, 2)
      assert.equal(summary.uncheckedIdle, 0)
    })

    it('does not queue contacts that are already in progress', async () => {
      const list = await seedList()
      await m.cleanup.startEmailCheckRun(list.id, 'unchecked')
      assert.equal((await m.cleanup.startEmailCheckRun(list.id, 'unchecked')).queued, 0)

      // Re-verify all picks up the 5 checked contacts and skips the 2 in progress.
      assert.equal((await m.cleanup.startEmailCheckRun(list.id, 'all')).queued, 5)
      assert.equal((await m.cleanup.getEmailCheckSummary(list.id)).inProgress, 7)
      assert.equal(await verifyJobCount(), 7)
    })

    it('stops counting a contact as in progress once the worker writes a newer result', async () => {
      const list = await seedList()
      await m.cleanup.startEmailCheckRun(list.id, 'unchecked')

      const contact = await contactByEmailInList(list.id, 'new1@a.com')
      const { eq } = m.orm
      await m.db.db
        .update(m.schema.contacts)
        .set({
          metadata: {
            ...(contact.metadata as Record<string, string>),
            ...checked('invalid', new Date(Date.now() + 1000).toISOString()),
          },
        })
        .where(eq(m.schema.contacts.id, contact.id))

      const summary = await m.cleanup.getEmailCheckSummary(list.id)
      assert.equal(summary.inProgress, 1)
      assert.equal(summary.invalid, 3)
    })

    it('lets a run that never finished be queued again after 24 hours', async () => {
      const list = await createList('Stale')
      await m.db.db.insert(m.schema.contacts).values([
        { listId: list.id, email: 'stuck@a.com', metadata: { _email_verify_queued_at: minutesAgo(25 * 60) } },
      ])
      assert.equal((await m.cleanup.getEmailCheckSummary(list.id)).inProgress, 0)
      assert.equal((await m.cleanup.startEmailCheckRun(list.id, 'unchecked')).queued, 1)
    })
  })

  describe('removeFlaggedContacts', () => {
    it('ignores contacts that are not flagged', async () => {
      const list = await seedList()
      const good = await contactByEmailInList(list.id, 'good@a.com')
      const bad = await contactByEmailInList(list.id, 'bad1@a.com')

      const result = await m.cleanup.removeFlaggedContacts({
        listId: list.id,
        contactIds: [good.id, bad.id],
        suppress: false,
      })
      assert.deepEqual(result.removed.map((r) => r.email), ['bad1@a.com'])
      assert.ok(await contactByEmailInList(list.id, 'good@a.com'))
    })

    it('adds removed addresses to the suppression list when asked', async () => {
      const list = await seedList()
      const bad = await contactByEmailInList(list.id, 'bad1@a.com')
      const result = await m.cleanup.removeFlaggedContacts({ listId: list.id, contactIds: [bad.id], suppress: true })
      assert.equal(result.suppressed, 1)

      const { eq } = m.orm
      const [row] = await m.db.db
        .select()
        .from(m.schema.suppressions)
        .where(eq(m.schema.suppressions.email, 'bad1@a.com'))
      assert.equal(row.source, 'email-checker')
      assert.deepEqual(row.metadata, { verdict: 'invalid' })
    })

    it('removes by verdict within the chosen list only, leaving bounced and other verdicts', async () => {
      const list = await seedList()
      const other = await createList('Other')
      await m.db.db.insert(m.schema.contacts).values([
        { listId: other.id, email: 'bad@b.com', status: 'undeliverable', metadata: checked('invalid') },
      ])

      const result = await m.cleanup.removeFlaggedContacts({ listId: list.id, verdicts: ['invalid'], suppress: false })
      assert.deepEqual(result.removed.map((r) => r.email).sort(), ['bad1@a.com', 'bad2@a.com'])
      assert.equal(result.suppressed, 0)
      assert.ok(await contactByEmailInList(list.id, 'bounced@a.com'))
      assert.ok(await contactByEmailInList(list.id, 'catchall@a.com'))
      assert.ok(await contactByEmailInList(other.id, 'bad@b.com'))
    })

    it('marks copies of a removed address in other lists as undeliverable', async () => {
      const lists = Object.fromEntries(
        await Promise.all(
          ['src', 'plain', 'cased', 'bounced', 'fresher', 'already'].map(async (k) => [k, await createList(k)] as const),
        ),
      )
      const removedCheckAt = minutesAgo(60)
      await m.db.db.insert(m.schema.contacts).values([
        { listId: lists.src.id, email: 'dead@x.com', status: 'undeliverable', metadata: checked('invalid', removedCheckAt) },
        { listId: lists.plain.id, email: 'dead@x.com', metadata: { plan: 'pro' } },
        { listId: lists.cased.id, email: ' Dead@X.com', status: 'pending' },
        { listId: lists.bounced.id, email: 'dead@x.com', status: 'bounced' },
        { listId: lists.fresher.id, email: 'dead@x.com', metadata: checked('safe', minutesAgo(1)) },
        { listId: lists.already.id, email: 'dead@x.com', status: 'undeliverable', metadata: checked('risky', minutesAgo(120)) },
        { listId: lists.plain.id, email: 'bystander@x.com' },
      ])

      const result = await m.cleanup.removeFlaggedContacts({
        listId: lists.src.id,
        verdicts: ['invalid'],
        suppress: false,
      })
      assert.equal(result.removed.length, 1)
      assert.equal(result.markedElsewhere, 3)

      const plain = await contactByEmailInList(lists.plain.id, 'dead@x.com')
      assert.equal(plain.status, 'undeliverable')
      assert.deepEqual(plain.metadata, checked('invalid', removedCheckAt, { plan: 'pro' }))

      assert.equal((await contactByEmailInList(lists.cased.id, ' Dead@X.com')).status, 'undeliverable')
      assert.equal((await contactByEmailInList(lists.bounced.id, 'dead@x.com')).status, 'bounced')

      // A newer check of its own wins over the older result being copied.
      const fresher = await contactByEmailInList(lists.fresher.id, 'dead@x.com')
      assert.equal(fresher.status, 'active')
      assert.equal((fresher.metadata as Record<string, string>)._email_verify_reachable, 'safe')

      const already = await contactByEmailInList(lists.already.id, 'dead@x.com')
      assert.equal((already.metadata as Record<string, string>)._email_verify_reachable, 'invalid')

      assert.equal((await contactByEmailInList(lists.plain.id, 'bystander@x.com')).status, 'active')

      // Marked copies show up in the checker for their own list.
      const flagged = await m.cleanup.listFlaggedContacts({
        listId: lists.plain.id,
        verdicts: ['invalid'],
        page: 1,
        limit: 50,
      })
      assert.deepEqual(flagged.data.map((r) => r.email), ['dead@x.com'])
    })
  })

  describe('GET /api/internal/duplicates/cross-list', () => {
    // Regression: interpolating a JS array into ANY(...) produced ANY(($1, $2)),
    // which Postgres rejects, so this route failed whenever duplicates existed.
    async function call(query = '') {
      const req = new m.server.NextRequest(`http://localhost/api/internal/duplicates/cross-list${query}`)
      const res = await m.crossList.GET(req)
      assert.equal(res.status, 200)
      return res.json()
    }

    it('groups addresses that appear in more than one list', async () => {
      const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(createList))
      await m.db.db.insert(m.schema.contacts).values([
        { listId: a.id, email: 'one@x.com' },
        { listId: b.id, email: 'ONE@x.com ' },
        { listId: c.id, email: 'one@x.com', status: 'bounced' },
        { listId: a.id, email: 'two@x.com' },
        { listId: b.id, email: 'two@x.com' },
        { listId: a.id, email: 'solo@x.com' },
      ])

      const all = await call()
      assert.equal(all.meta.total, 2)
      assert.deepEqual(
        all.data.map((g: { normEmail: string; lists: unknown[] }) => [g.normEmail, g.lists.length]),
        [
          ['one@x.com', 3],
          ['two@x.com', 2],
        ],
      )

      const page2 = await call('?limit=1&page=2')
      assert.deepEqual(page2.data.map((g: { normEmail: string }) => g.normEmail), ['two@x.com'])

      const searched = await call('?search=one')
      assert.equal(searched.meta.total, 1)
    })
  })
})
