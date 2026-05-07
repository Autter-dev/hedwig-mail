export interface SendOptions {
  to: string
  from: string
  fromName: string
  subject: string
  replyTo?: string
  html: string
  text?: string
  headers?: Record<string, string>
}

export interface EmailProviderAdapter {
  send(options: SendOptions): Promise<{ messageId: string }>
  validate(): Promise<boolean>
}

export interface ProviderConfig {
  apiKey?: string
  region?: string
  fromDomain?: string
  replyToEmail?: string
}
