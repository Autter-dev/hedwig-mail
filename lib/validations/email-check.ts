import { z } from 'zod'

export const v1EmailCheckSchema = z.object({
  to_email: z.string().min(3, 'to_email is required').max(320),
  check_gravatar: z.boolean().optional(),
})

export type V1EmailCheckInput = z.infer<typeof v1EmailCheckSchema>

export const internalEmailCheckSchema = z.object({
  email: z.string().email().max(320),
})

export const emailCheckVerdictSchema = z.enum(['invalid', 'risky', 'unknown'])

export type EmailCheckFlaggedVerdict = z.infer<typeof emailCheckVerdictSchema>

// listId is optional everywhere: omitted means "all lists".
export const emailCheckVerifySchema = z.object({
  listId: z.string().uuid().optional(),
  scope: z.enum(['unchecked', 'all']).default('unchecked'),
})

export type EmailCheckVerifyInput = z.infer<typeof emailCheckVerifySchema>

export const emailCheckRemoveSchema = z
  .object({
    listId: z.string().uuid().optional(),
    // Either remove specific contacts, or every contact matching the verdicts.
    contactIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
    verdicts: z.array(emailCheckVerdictSchema).min(1).optional(),
    suppress: z.boolean().default(false),
  })
  .refine((v) => !!v.contactIds !== !!v.verdicts, {
    message: 'Provide either contactIds or verdicts, not both',
  })

export type EmailCheckRemoveInput = z.infer<typeof emailCheckRemoveSchema>
