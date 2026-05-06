'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'

interface CheckResponse {
  result: {
    input: string
    is_reachable: string
    misc: Record<string, unknown>
    mx: Record<string, unknown>
    smtp: Record<string, unknown>
    syntax: Record<string, unknown>
    debug: Record<string, unknown>
  }
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

  return (
    <div className="space-y-6 max-w-2xl">
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

      {verdict && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium">
              Reachability: <span className="font-mono">{verdict}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Invalid or risky addresses are moved to the Undeliverable tab after automated verification on import.
            </p>
            <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[480px] mt-4">
              {JSON.stringify(response?.result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
