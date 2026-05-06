import { z } from 'zod'

export const v1EmailCheckSchema = z.object({
  to_email: z.string().min(3, 'to_email is required').max(320),
  check_gravatar: z.boolean().optional(),
})

export type V1EmailCheckInput = z.infer<typeof v1EmailCheckSchema>

export const internalListEmailCheckSchema = z.object({
  email: z.string().email().max(320),
})
