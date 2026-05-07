'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'

type ReachabilityVerdict = 'safe' | 'invalid' | 'risky' | 'unknown'

interface MxError {
  type: string
  message: string
}

interface SmtpDetails {
  can_connect_smtp: boolean
  has_full_inbox: boolean
  is_catch_all: boolean
  is_deliverable: boolean
  is_disabled: boolean
}

interface SmtpErrorShape {
  error: {
    type: string
    message: string
  }
  description?: string
}

interface CheckResult {
  input: string
  is_reachable: ReachabilityVerdict
  misc: {
    is_disposable: boolean
    is_role_account: boolean
    is_b2c: boolean
    gravatar_url: string | null
    haveibeenpwned: boolean | null
  }
  mx:
    | {
        accepts_mail: boolean
        records: string[]
      }
    | {
        error: MxError
      }
  smtp: SmtpDetails | SmtpErrorShape
  syntax: {
    address: string | null
    domain: string
    is_valid_syntax: boolean
    username: string
    normalized_email: string | null
    suggestion: string | null
  }
  debug: {
    backend_name: string
    start_time: string
    end_time: string
    duration: { secs: number; nanos: number }
    smtp?: {
      verif_method?: {
        type: string
        host?: string
        smtp_port?: number
        provider?: string
        method?: string
      }
    }
  }
}

interface CheckResponse {
  result: CheckResult
  listId: string
}

interface Props {
  listId: string
}

export function EmailCheckerTab({ listId }: Props) {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<CheckResponse | null>(null)

  async function runCheck() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      toast({ title: 'Enter an email address', variant: 'destructive' })
      return
    }
    setLoading(true)
    setResponse(null)
    try {
      const res = await fetch(`/api/internal/lists/${listId}/email-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'Check failed', variant: 'destructive' })
        return
      }
      const data = (await res.json()) as CheckResponse
      setResponse(data)
    } catch {
      toast({ title: 'Check failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const verdict = response?.result?.is_reachable
  const result = response?.result
  const smtpOk = !!result && 'is_deliverable' in result.smtp && result.smtp.is_deliverable
  const mxOk = !!result && 'accepts_mail' in result.mx && result.mx.accepts_mail
  const syntaxOk = !!result && result.syntax.is_valid_syntax

  function verdictMeta(value: ReachabilityVerdict) {
    if (value === 'safe') {
      return {
        label: 'Safe',
        description: 'Mailbox looks deliverable based on syntax, MX, and SMTP checks.',
        badgeVariant: 'secondary' as const,
      }
    }
    if (value === 'risky') {
      return {
        label: 'Risky',
        description: 'Address may receive mail, but one or more risk signals were found.',
        badgeVariant: 'outline' as const,
      }
    }
    if (value === 'invalid') {
      return {
        label: 'Invalid',
        description: 'Address failed one or more required deliverability checks.',
        badgeVariant: 'destructive' as const,
      }
    }
    return {
      label: 'Unknown',
      description: 'Verification completed, but confidence is limited for this address.',
      badgeVariant: 'outline' as const,
    }
  }

  function boolLabel(value: boolean) {
    return value ? 'Yes' : 'No'
  }

  const verdictView = verdict ? verdictMeta(verdict) : null
  const checks = result
    ? [
        { label: 'Syntax valid', value: syntaxOk },
        { label: 'MX accepts mail', value: mxOk },
        { label: 'SMTP deliverable', value: smtpOk },
        { label: 'Disposable inbox', value: !result.misc.is_disposable },
      ]
    : []

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Run the same SMTP verification used after imports. This does not change contacts until you add or import them.
          </p>
          <div className="space-y-2">
            <Label htmlFor="check-email">Email</Label>
            <div className="flex gap-2 flex-wrap">
              <Input
                id="check-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runCheck()
                }}
                className="max-w-md"
              />
              <Button type="button" onClick={runCheck} disabled={loading}>
                {loading ? 'Checking...' : 'Check'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result && verdictView && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Verification result
                </p>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{verdictView.label}</h3>
                  <Badge variant={verdictView.badgeVariant}>{verdictView.label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{verdictView.description}</p>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {result.syntax.normalized_email || result.input}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {checks.map((check) => (
                <div key={check.label} className="rounded-md border bg-background px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{check.label}</p>
                  <p className="mt-1 text-sm font-medium">{check.value ? 'Pass' : 'Fail'}</p>
                </div>
              ))}
            </div>

            <Separator />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border bg-background p-4 space-y-3">
                <h4 className="text-sm font-semibold">Mailbox signals</h4>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Deliverable</dt>
                    <dd>{smtpOk ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Catch-all domain</dt>
                    <dd>
                      {'is_catch_all' in result.smtp
                        ? boolLabel(result.smtp.is_catch_all)
                        : 'Unknown'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Role account</dt>
                    <dd>{boolLabel(result.misc.is_role_account)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Disposable</dt>
                    <dd>{boolLabel(result.misc.is_disposable)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border bg-background p-4 space-y-3">
                <h4 className="text-sm font-semibold">Infrastructure checks</h4>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Domain</dt>
                    <dd className="font-mono">{result.syntax.domain}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">MX accepts mail</dt>
                    <dd>{mxOk ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">SMTP host</dt>
                    <dd className="font-mono">
                      {result.debug.smtp?.verif_method?.host || 'Not provided'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Response time</dt>
                    <dd>
                      {result.debug.duration.secs}s{' '}
                      {Math.round(result.debug.duration.nanos / 1_000_000)}ms
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {'records' in result.mx && result.mx.records.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">MX records</h4>
                <div className="flex flex-wrap gap-2">
                  {result.mx.records.map((record) => (
                    <Badge key={record} variant="outline" className="font-mono text-[11px]">
                      {record}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <details className="rounded-md border bg-background p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Show raw verification payload
              </summary>
              <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>

            <p className="text-xs text-muted-foreground">
              Invalid or risky addresses are moved to the Undeliverable tab after automated
              verification on import.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
