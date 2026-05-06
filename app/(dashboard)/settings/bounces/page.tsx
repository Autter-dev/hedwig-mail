"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

interface AppSettingsBounces {
  id: string
  emailVerifyFromEmail: string | null
  emailVerifyHelloName: string | null
  updatedAt: string
}

export default function BouncesSettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fromEmail, setFromEmail] = useState("")
  const [helloName, setHelloName] = useState("")

  async function fetchSettings() {
    setLoading(true)
    try {
      const res = await fetch("/api/internal/settings")
      if (!res.ok) throw new Error("Failed to fetch settings")
      const data: AppSettingsBounces = await res.json()
      setFromEmail(data.emailVerifyFromEmail ?? "")
      setHelloName(data.emailVerifyHelloName ?? "")
    } catch {
      toast({
        title: "Error",
        description: "Could not load settings. Please refresh.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailVerifyFromEmail: fromEmail.trim() || null,
          emailVerifyHelloName: helloName.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save settings")
      }
      toast({ title: "Settings saved", description: "Your changes have been applied." })
      await fetchSettings()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong."
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading">Bounces</h1>
        <p className="text-sm text-muted-foreground mt-1">
          SMTP identity used when verifying addresses (MAIL FROM and EHLO). Defaults are generated on first use if you
          leave these blank and no EMAIL_VERIFY_FROM_EMAIL or EMAIL_VERIFY_HELLO_NAME env vars are set.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ) : (
        <div className="border rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Email verification (SMTP)</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Many receiving servers expect a plausible sender domain. Use an address on a domain you control, and a
              hello name that matches your public hostname when possible.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-verify-from-email">From email</Label>
              <Input
                id="email-verify-from-email"
                type="email"
                placeholder="noreply@yourdomain.com"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-verify-hello-name">Hello name</Label>
              <Input
                id="email-verify-hello-name"
                type="text"
                placeholder="yourdomain.com"
                value={helloName}
                onChange={(e) => setHelloName(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground space-y-2">
            <span className="block">
              Worker: EMAIL_VERIFY_BACKFILL_ON_START=true (and optionally EMAIL_VERIFY_BACKFILL_MAX) queues
              VERIFY_CONTACT_EMAIL for contacts missing a verification timestamp when the worker starts.
            </span>
            <span className="block">
              Throttle probes with EMAIL_VERIFY_MIN_GAP_MS (default 2500), EMAIL_VERIFY_WORKER_CONCURRENCY (default 1,
              max 4), and optional EMAIL_VERIFY_ENQUEUE_STAGGER_MS for staggered bulk enqueue and backfill.
            </span>
          </p>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
