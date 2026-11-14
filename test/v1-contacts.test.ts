/**
 * Integration tests for the v1 contact write routes.
 *
 * These run against a real Postgres and DELETE DATA in it. They only run when
 * TEST_DATABASE_URL is set, and never read DATABASE_URL. `npm test` runs test files
 * one at a time, since every file shares this database.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hedwig_test npm test
 */
// Must be the first import: it points DATABASE_URL at the test database before lib/db loads.
import { skipWithoutDatabase } from './helpers/test-env'
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as orm from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import * as schema from '@/lib/db/schema'
import * as queue from '@/lib/queue'
import { runMigrationsWithLock } from '@/lib/db/run-migrations'
import * as v1Contacts from '@/app/api/v1/lists/[listId]/contacts/route'
import * as v1Contact from '@/app/api/v1/lists/[listId]/contacts/[id]/route'
import * as internalContacts from '@/app/api/internal/lists/[id]/contacts/route'

// Static imports keep a single instance of lib/db and lib/queue (see email-checker.test.ts).
const m = { db: dbModule, schema, queue, orm, v1Contacts, v1Contact, internalContacts }

const API_KEY = 'test-api-key-for-v1-contacts'
const DUPLICATE_ERROR = 'A contact with this email already exists in this list'

async function createList(name: string, requireDoubleOptIn = false) {
  const [list] = await m.db.db.insert(m.schema.lists).values({ name, requireDoubleOptIn }).returning()
  return list
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function postContact(listId: string, body: unknown) {
  const req = jsonRequest(`http://localhost/api/v1/lists/${listId}/contacts`, 'POST', body)
  const res = await m.v1Contacts.POST(req, { params: { listId } })
  return { status: res.status, body: await res.json() }
}

async function contactsIn(listId: string) {
  const { contacts } = m.schema
  return m.db.db.select().from(contacts).where(m.orm.eq(contacts.listId, listId))
}

async function jobCount(name: string) {
  const result = await m.db.db.execute(
    m.orm.sql`select count(*)::int as n from pgboss.job where name = ${name}`,
  )
  return (result.rows[0] as { n: number }).n
}

async function auditCount(action: string) {
  const { auditLogs } = m.schema
  const rows = await m.db.db.select().from(auditLogs).where(m.orm.eq(auditLogs.action, action))
  return rows.length
}

describe('v1 contacts API', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    await runMigrationsWithLock()
    // Start pg-boss once so the job table and queues exist before the first count.
    await m.queue.getQueue()
  })

  beforeEach(async () => {
    const { sql } = m.orm
    await m.db.db.execute(sql`delete from contacts; delete from lists; delete from audit_logs; delete from api_keys`)
    await m.db.db.execute(sql`delete from pgboss.job`)
    await m.db.db.insert(m.schema.apiKeys).values({
      name: 'test',
      keyHash: bcrypt.hashSync(API_KEY, 4),
      rateLimitPerMinute: 10_000,
      rateLimitTokens: 10_000,
    })
  })

  after(async () => {
    await (await m.queue.getQueue()).stop({ graceful: false }).catch(() => {})
    await m.db.pool.end()
  })

  describe('POST /api/v1/lists/:listId/contacts', () => {
    it('creates a new contact with 201 and queues verification and an audit entry', async () => {
      const list = await createList('Signups')

      const res = await postContact(list.id, { email: 'new@x.com', firstName: 'Ada' })

      assert.equal(res.status, 201)
      assert.equal(res.body.error, null)
      assert.deepEqual(res.body.meta, {})
      assert.equal(res.body.data.email, 'new@x.com')
      assert.equal(res.body.data.firstName, 'Ada')
      assert.equal(res.body.data.status, 'active')

      const rows = await contactsIn(list.id)
      assert.deepEqual(rows.map((r) => r.id), [res.body.data.id])
      assert.equal(await jobCount(m.queue.JOBS.VERIFY_CONTACT_EMAIL), 1)
      assert.equal(await auditCount('contact.create'), 1)
    })

    it('answers a duplicate with a 409 envelope carrying the existing contact, without re-queueing jobs', async () => {
      const list = await createList('Double opt-in', true)
      const first = await postContact(list.id, { email: 'dup@x.com' })
      assert.equal(first.status, 201)
      assert.equal(first.body.data.status, 'pending')
      assert.equal(await jobCount(m.queue.JOBS.SEND_CONFIRMATION), 1)
      assert.equal(await jobCount(m.queue.JOBS.VERIFY_CONTACT_EMAIL), 1)

      // The integration retries until it sees a 2xx or 409, so repeats must stay 409.
      for (let i = 0; i < 2; i++) {
        const again = await postContact(list.id, { email: 'dup@x.com', firstName: 'Changed' })
        assert.equal(again.status, 409)
        assert.deepEqual(again.body, {
          data: { id: first.body.data.id, email: 'dup@x.com', status: 'pending' },
          meta: {},
          error: DUPLICATE_ERROR,
        })
      }

      const rows = await contactsIn(list.id)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].firstName, null)
      assert.equal(await jobCount(m.queue.JOBS.SEND_CONFIRMATION), 1)
      assert.equal(await jobCount(m.queue.JOBS.VERIFY_CONTACT_EMAIL), 1)
      assert.equal(await auditCount('contact.create'), 1)
    })

    it('still answers 201 when queueing jobs and writing the audit log fail', async (t) => {
      const list = await createList('Double opt-in', true)
      const boss = await m.queue.getQueue()
      t.mock.method(boss, 'send', async () => {
        throw new Error('queue down')
      })
      t.mock.method(boss, 'insert', async () => {
        throw new Error('queue down')
      })
      const { sql } = m.orm
      await m.db.db.execute(sql`alter table audit_logs rename to audit_logs_unavailable`)
      try {
        const res = await postContact(list.id, { email: 'flaky@x.com' })
        assert.equal(res.status, 201)
        assert.equal(res.body.error, null)
        assert.equal(res.body.data.email, 'flaky@x.com')
      } finally {
        await m.db.db.execute(sql`alter table audit_logs_unavailable rename to audit_logs`)
      }
      assert.equal((await contactsIn(list.id)).length, 1)
    })

    it('answers an unexpected error with a JSON 500 envelope that leaks no details', async () => {
      // Not a uuid, so Postgres rejects the list lookup.
      const res = await postContact('not-a-uuid', { email: 'x@x.com' })
      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { data: null, meta: {}, error: 'Internal server error' })
    })

    it('keeps 400 and 404 responses unchanged', async () => {
      const list = await createList('Signups')
      const invalid = await postContact(list.id, { email: 'not an email' })
      assert.equal(invalid.status, 400)
      assert.equal(invalid.body.error, 'Validation failed')

      const missing = await postContact('00000000-0000-0000-0000-000000000000', { email: 'x@x.com' })
      assert.equal(missing.status, 404)
      assert.deepEqual(missing.body, { data: null, meta: {}, error: 'List not found' })
    })
  })

  describe('PUT /api/v1/lists/:listId/contacts/:id', () => {
    it('answers 409 when the new email belongs to another contact in the list', async () => {
      const list = await createList('Signups')
      await m.db.db.insert(m.schema.contacts).values({ listId: list.id, email: 'taken@x.com' })
      const [mover] = await m.db.db
        .insert(m.schema.contacts)
        .values({ listId: list.id, email: 'mover@x.com' })
        .returning()

      const req = jsonRequest(
        `http://localhost/api/v1/lists/${list.id}/contacts/${mover.id}`,
        'PUT',
        { email: 'taken@x.com' },
      )
      const res = await m.v1Contact.PUT(req, { params: { listId: list.id, id: mover.id } })

      assert.equal(res.status, 409)
      assert.deepEqual(await res.json(), { data: null, meta: {}, error: DUPLICATE_ERROR })
      const rows = await contactsIn(list.id)
      assert.deepEqual(rows.map((r) => r.email).sort(), ['mover@x.com', 'taken@x.com'])
    })
  })

  describe('POST /api/internal/lists/:id/contacts', () => {
    // Regression: drizzle-orm wraps driver errors and puts the SQL in the message, so
    // matching 'unique' in the message never fired and duplicates became a 500.
    it('answers a duplicate with 409', async () => {
      const list = await createList('Signups')
      await m.db.db.insert(m.schema.contacts).values({ listId: list.id, email: 'dup@x.com' })

      const req = new NextRequest(`http://localhost/api/internal/lists/${list.id}/contacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dup@x.com' }),
      })
      const res = await m.internalContacts.POST(req, { params: { id: list.id } })

      assert.equal(res.status, 409)
      assert.deepEqual(await res.json(), { error: DUPLICATE_ERROR })
    })
  })
})
