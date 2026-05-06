import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, unique, doublePrecision, index
} from 'drizzle-orm/pg-core'

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  requireDoubleOptIn: boolean('require_double_opt_in').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  metadata: jsonb('metadata').default({}).$type<Record<string, string>>(),
  status: text('status').notNull().default('active'), // active | pending | bounced | unsubscribed | undeliverable
  unsubscribeToken: uuid('unsubscribe_token').notNull().defaultRandom().unique(),
  confirmationToken: uuid('confirmation_token').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueListEmail: unique().on(t.listId, t.email),
}))

export const emailProviders = pgTable('email_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(), // resend | ses
  configEncrypted: text('config_encrypted').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  rateLimitPerSecond: integer('rate_limit_per_second').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  subject: text('subject').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  listId: uuid('list_id').notNull().references(() => lists.id),
  providerId: uuid('provider_id').references(() => emailProviders.id),
  templateJson: jsonb('template_json').notNull().default([]).$type<Block[]>(),
  templateHtml: text('template_html'),
  status: text('status').notNull().default('draft'), // draft | scheduled | sending | sent | failed
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  totalRecipients: integer('total_recipients'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  disableTracking: boolean('disable_tracking').notNull().default(false),
  sendRatePerMinute: integer('send_rate_per_minute'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaignSends = pgTable('campaign_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // pending | sent | bounced | failed
  providerMessageId: text('provider_message_id'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueCampaignContact: unique().on(t.campaignId, t.contactId),
}))

export const campaignEvents = pgTable('campaign_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignSendId: uuid('campaign_send_id').notNull().references(() => campaignSends.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // open | click | bounce | complaint | unsubscribe
  linkUrl: text('link_url'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  reason: text('reason').notNull(), // bounce | complaint | unsubscribe | manual | imported
  source: text('source'),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  subject: text('subject').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  templateJson: jsonb('template_json').notNull().default([]).$type<Block[]>(),
  templateHtml: text('template_html'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(60),
  rateLimitTokens: doublePrecision('rate_limit_tokens').notNull().default(60),
  rateLimitUpdatedAt: timestamp('rate_limit_updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(), // user | api_key | system
  actorId: text('actor_id'),
  actorLabel: text('actor_label'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
  resourceIdx: index('audit_logs_resource_idx').on(t.resourceType, t.resourceId),
}))

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: text('file_id').notNull().unique(),
  name: text('name').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  s3Key: text('s3_key').notNull(),
  kind: text('kind').notNull(), // image | file
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  kindIdx: index('assets_kind_idx').on(t.kind),
  createdIdx: index('assets_created_idx').on(t.createdAt),
}))

// Block type used in templateJson
export type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer'

export interface Block {
  id: string
  type: BlockType
  props: Record<string, unknown>
}

// Form field type used in forms.fields
export type FormFieldType = 'email' | 'text' | 'checkbox' | 'select'

export interface FormField {
  id: string
  key: string
  label: string
  type: FormFieldType
  required: boolean
  options?: string[]
}

export const forms = pgTable('forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  providerId: uuid('provider_id').references(() => emailProviders.id),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  fields: jsonb('fields').notNull().default([]).$type<FormField[]>(),
  doubleOptIn: boolean('double_opt_in').notNull().default(false),
  confirmationSubject: text('confirmation_subject').notNull().default(''),
  confirmationTemplateJson: jsonb('confirmation_template_json').notNull().default([]).$type<Block[]>(),
  successMessage: text('success_message').notNull().default('Thanks for subscribing.'),
  redirectUrl: text('redirect_url'),
  brandingLogoFileId: text('branding_logo_file_id'),
  brandingPrimaryColor: text('branding_primary_color'),
  brandingBgColor: text('branding_bg_color'),
  brandingTextColor: text('branding_text_color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const formSubmissions = pgTable('form_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  payload: jsonb('payload').notNull().default({}).$type<Record<string, string>>(),
  outcome: text('outcome').notNull(), // created | updated | duplicate | suppressed | pending
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  formCreatedIdx: index('form_submissions_form_created_idx').on(t.formId, t.createdAt),
}))

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // admin | member
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
})

export const teamInvites = pgTable('team_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: text('invited_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export interface UnsubscribePageStateContent {
  title: string
  body: string
  buttonLabel?: string
}

export interface UnsubscribePageContent {
  confirm: UnsubscribePageStateContent
  confirmed: UnsubscribePageStateContent
  alreadyUnsubscribed: UnsubscribePageStateContent
  invalid: UnsubscribePageStateContent
}

export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey().default('singleton'),
  confirmationFromEmail: text('confirmation_from_email'),
  confirmationFromName: text('confirmation_from_name'),
  unsubscribePage: jsonb('unsubscribe_page').$type<UnsubscribePageContent | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Drizzle inferred types
export type List = typeof lists.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type EmailProvider = typeof emailProviders.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type CampaignSend = typeof campaignSends.$inferSelect
export type CampaignEvent = typeof campaignEvents.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type Suppression = typeof suppressions.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type Asset = typeof assets.$inferSelect
export type Template = typeof templates.$inferSelect
export type Form = typeof forms.$inferSelect
export type FormSubmission = typeof formSubmissions.$inferSelect
export type AppSettings = typeof appSettings.$inferSelect
export type User = typeof users.$inferSelect
export type TeamInvite = typeof teamInvites.$inferSelect
