import { z } from 'zod'

export const createContactSchema = z.object({
  email: z.string().email('Valid email is required'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  metadata: z.record(z.string()).optional(),
})

export const updateContactSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  status: z.enum(['active', 'pending', 'bounced', 'unsubscribed', 'undeliverable']).optional(),
})

export const bulkContactsSchema = z.object({
  contacts: z.array(createContactSchema).min(1).max(1000),
})

export type CreateContactInput = z.infer<typeof createContactSchema>
export type UpdateContactInput = z.infer<typeof updateContactSchema>
export type BulkContactsInput = z.infer<typeof bulkContactsSchema>
