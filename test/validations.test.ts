import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createContactSchema } from '@/lib/validations/contacts'
import { formSubmissionSchema } from '@/lib/validations/forms'
import { createProviderSchema } from '@/lib/validations/providers'
import { createTemplateSchema } from '@/lib/validations/templates'
import { createInviteSchema } from '@/lib/validations/team'

describe('zod validation schemas', () => {
  it('createContactSchema accepts a valid email + metadata record and rejects an invalid email', () => {
    const parsed = createContactSchema.parse({
      email: 'ada@example.com',
      metadata: { source: 'signup' },
    })
    assert.equal(parsed.email, 'ada@example.com')
    assert.deepEqual(parsed.metadata, { source: 'signup' })
    assert.equal(createContactSchema.safeParse({ email: 'not-an-email' }).success, false)
  })

  it('createContactSchema keeps the custom email error message', () => {
    const result = createContactSchema.safeParse({ email: 'nope' })
    assert.equal(result.success, false)
    assert.ok(result.error.issues.some((issue) => issue.message === 'Valid email is required'))
  })

  it('createInviteSchema validates the invited email', () => {
    assert.equal(createInviteSchema.safeParse({ email: 'ada@example.com' }).success, true)
    const result = createInviteSchema.safeParse({ email: 'not-an-email' })
    assert.equal(result.success, false)
    assert.ok(result.error.issues.some((issue) => issue.message === 'Enter a valid email'))
  })

  it('createProviderSchema keeps the custom message for a missing provider type', () => {
    const result = createProviderSchema.safeParse({ name: 'Provider', apiKey: 'k' })
    assert.equal(result.success, false)
    assert.ok(
      result.error.issues.some((issue) => issue.message === 'Type must be resend or ses'),
    )
  })

  it('createTemplateSchema rejects a non-uuid campaign id', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Welcome',
      fromCampaignId: 'not-a-uuid',
    })
    assert.equal(result.success, false)
  })

  it('formSubmissionSchema normalises and validates the submitted email', () => {
    const parsed = formSubmissionSchema.parse({ email: 'Ada@Example.com' })
    assert.equal(parsed.email, 'ada@example.com')
    assert.equal(formSubmissionSchema.safeParse({ email: 'bad' }).success, false)
  })
})
