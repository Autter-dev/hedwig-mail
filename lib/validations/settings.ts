import { z } from 'zod'

const optionalEmail = z
  .union([z.string().trim().email('Must be a valid email'), z.literal(''), z.null()])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional()

const optionalName = z
  .union([z.string().trim().max(200, 'Must be 200 characters or fewer'), z.literal(''), z.null()])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional()

const stateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  body: z.string().trim().min(1, 'Body is required').max(2000, 'Body must be 2000 characters or fewer'),
  buttonLabel: z
    .string()
    .trim()
    .max(80, 'Button label must be 80 characters or fewer')
    .optional(),
})

const unsubscribePageSchema = z
  .object({
    confirm: stateSchema,
    confirmed: stateSchema,
    alreadyUnsubscribed: stateSchema,
    invalid: stateSchema,
  })
  .nullable()
  .optional()

const optionalVerifyHello = z
  .union([z.string().trim().max(253, 'Must be 253 characters or fewer'), z.literal(''), z.null()])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional()

export const updateAppSettingsSchema = z.object({
  confirmationFromEmail: optionalEmail,
  confirmationFromName: optionalName,
  emailVerifyFromEmail: optionalEmail,
  emailVerifyHelloName: optionalVerifyHello,
  unsubscribePage: unsubscribePageSchema,
})

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>
