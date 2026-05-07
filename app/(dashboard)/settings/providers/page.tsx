"use client"

import { useEffect, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

interface Provider {
  id: string
  name: string
  type: string
  isDefault: boolean
  rateLimitPerSecond: number
  fromDomain?: string
  replyToEmail?: string
}

interface AddProviderForm {
  name: string
  type: "resend" | "ses" | ""
  apiKey: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  replyToEmail: string
}

const defaultForm: AddProviderForm = {
  name: "",
  type: "",
  apiKey: "",
  accessKeyId: "",
  secretAccessKey: "",
  region: "",
  replyToEmail: "",
}

export default function ProvidersPage() {
  const { toast } = useToast()
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<AddProviderForm>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

  async function fetchProviders() {
    setLoading(true)
    try {
      const res = await fetch("/api/internal/providers")
      if (!res.ok) throw new Error("Failed to fetch providers")
      const data = await res.json()
      setProviders(data)
    } catch {
      toast({
        title: "Error",
        description: "Could not load providers. Please refresh.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFormChange(field: keyof AddProviderForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleAddProvider() {
    if (!form.name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" })
      return
    }
    if (!form.type) {
      toast({ title: "Validation error", description: "Provider type is required.", variant: "destructive" })
      return
    }
    if (form.type === "resend" && !form.apiKey.trim()) {
      toast({ title: "Validation error", description: "API key is required for Resend.", variant: "destructive" })
      return
    }
    if (form.type === "ses") {
      if (!form.accessKeyId.trim() || !form.secretAccessKey.trim()) {
        toast({ title: "Validation error", description: "Access Key ID and Secret Access Key are required for SES.", variant: "destructive" })
        return
      }
      if (!form.region.trim()) {
        toast({ title: "Validation error", description: "Region is required for SES.", variant: "destructive" })
        return
      }
    }

    setSaving(true)
    try {
      const body: Record<string, string> = {
        name: form.name.trim(),
        type: form.type,
      }

      if (form.type === "resend") {
        body.apiKey = form.apiKey.trim()
      } else if (form.type === "ses") {
        body.apiKey = `${form.accessKeyId.trim()}:${form.secretAccessKey.trim()}`
        body.region = form.region.trim()
      }

      if (form.replyToEmail.trim()) {
        body.replyToEmail = form.replyToEmail.trim()
      }

      const res = await fetch("/api/internal/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to add provider")
      }

      toast({ title: "Provider added", description: `${form.name} has been added.` })
      setForm(defaultForm)
      setDialogOpen(false)
      await fetchProviders()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong."
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id)
    try {
      const res = await fetch(`/api/internal/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      })
      if (!res.ok) throw new Error("Failed to set default")
      toast({ title: "Default updated", description: "Default provider has been updated." })
      await fetchProviders()
    } catch {
      toast({ title: "Error", description: "Could not set default provider.", variant: "destructive" })
    } finally {
      setSettingDefaultId(null)
    }
  }

  async function handleValidate(id: string) {
    setValidatingId(id)
    try {
      const res = await fetch(`/api/internal/providers/${id}/validate`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Request failed")
      const data = await res.json()
      if (data.valid) {
        toast({ title: "Connection valid", description: "The provider connection is working." })
      } else {
        toast({ title: "Connection failed", description: "Could not connect to the provider. Check your credentials.", variant: "destructive" })
      }
    } catch {
      toast({ title: "Error", description: "Validation request failed.", variant: "destructive" })
    } finally {
      setValidatingId(null)
    }
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = window.confirm(`Delete provider "${name}"? This cannot be undone.`)
    if (!confirmed) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/internal/providers/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast({ title: "Provider deleted", description: `${name} has been removed.` })
      await fetchProviders()
    } catch {
      toast({ title: "Error", description: "Could not delete provider.", variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  function handleDialogClose(open: boolean) {
    setDialogOpen(open)
    if (!open) {
      setForm(defaultForm)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-heading">Email Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect and manage your email sending providers.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button>Add Provider</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Email Provider</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="provider-name">Name</Label>
                <Input
                  id="provider-name"
                  placeholder="My Resend account"
                  value={form.name}
                  onChange={(e) => handleFormChange("name", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(val) => handleFormChange("type", val)}
                >
                  <SelectTrigger id="provider-type">
                    <SelectValue placeholder="Select provider type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resend">Resend</SelectItem>
                    <SelectItem value="ses">Amazon SES</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-reply-to">Default Reply-To (optional)</Label>
                <Input
                  id="provider-reply-to"
                  placeholder="replies@yourdomain.com"
                  value={form.replyToEmail}
                  onChange={(e) => handleFormChange("replyToEmail", e.target.value)}
                />
              </div>

              {form.type === "resend" && (
                <>
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
                    <p className="font-medium text-foreground">How to get your Resend API key</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>
                        Sign in at{" "}
                        <a
                          href="https://resend.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-foreground"
                        >
                          resend.com/api-keys
                        </a>
                        .
                      </li>
                      <li>Click &quot;Create API Key&quot;, give it a name.</li>
                      <li>
                        Set permission to <span className="font-medium text-foreground">Full access</span>, or{" "}
                        <span className="font-medium text-foreground">Sending access</span> if you only need to send.
                      </li>
                      <li>
                        Verify your sending domain at{" "}
                        <a
                          href="https://resend.com/domains"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-foreground"
                        >
                          resend.com/domains
                        </a>{" "}
                        before sending.
                      </li>
                      <li>Copy the key (starts with re_) and paste it below. It is only shown once.</li>
                    </ol>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="resend-api-key">API Key</Label>
                    <Input
                      id="resend-api-key"
                      type="password"
                      placeholder="re_..."
                      value={form.apiKey}
                      onChange={(e) => handleFormChange("apiKey", e.target.value)}
                    />
                  </div>
                </>
              )}

              {form.type === "ses" && (
                <>
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
                    <p className="font-medium text-foreground">How to get your AWS SES credentials</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>
                        Open the{" "}
                        <a
                          href="https://console.aws.amazon.com/iam/home#/users"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-foreground"
                        >
                          IAM Users console
                        </a>{" "}
                        and create a new user (programmatic access).
                      </li>
                      <li>
                        Attach a policy with these permissions:
                        <code className="block mt-1 p-2 bg-background rounded text-[11px] font-mono">
                          ses:SendEmail, ses:SendRawEmail, ses:GetAccountSendingEnabled, ses:GetSendQuota
                        </code>
                        You can use the AWS-managed{" "}
                        <span className="font-medium text-foreground">AmazonSESFullAccess</span> policy as a quick
                        option.
                      </li>
                      <li>
                        Under the user, go to{" "}
                        <span className="font-medium text-foreground">Security credentials</span> and create an
                        access key. Copy the Access Key ID and Secret Access Key.
                      </li>
                      <li>
                        Verify your sending identity (domain or email) in the{" "}
                        <a
                          href="https://console.aws.amazon.com/ses/home#/verified-identities"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-foreground"
                        >
                          SES console
                        </a>
                        , and request production access to leave the sandbox.
                      </li>
                      <li>Use the same region where your identity is verified (for example, us-east-1).</li>
                    </ol>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ses-access-key-id">Access Key ID</Label>
                    <Input
                      id="ses-access-key-id"
                      placeholder="AKIA..."
                      value={form.accessKeyId}
                      onChange={(e) => handleFormChange("accessKeyId", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ses-secret-key">Secret Access Key</Label>
                    <Input
                      id="ses-secret-key"
                      type="password"
                      placeholder="Your secret key"
                      value={form.secretAccessKey}
                      onChange={(e) => handleFormChange("secretAccessKey", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ses-region">Region</Label>
                    <Input
                      id="ses-region"
                      placeholder="us-east-1"
                      value={form.region}
                      onChange={(e) => handleFormChange("region", e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleDialogClose(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleAddProvider} disabled={saving || !form.type}>
                {saving ? "Saving..." : "Add Provider"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <div className="border rounded-xl p-12 text-center text-muted-foreground">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          <p className="text-sm">No providers connected yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Provider&quot; to connect your first email provider.</p>
        </div>
      ) : (
        <div className="border rounded-xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rate Limit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {provider.type === "ses" ? "Amazon SES" : "Resend"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {provider.isDefault ? (
                      <Badge>Default</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not default</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {provider.rateLimitPerSecond} / sec
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!provider.isDefault && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetDefault(provider.id)}
                          disabled={settingDefaultId === provider.id}
                        >
                          {settingDefaultId === provider.id ? "Updating..." : "Set as Default"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleValidate(provider.id)}
                        disabled={validatingId === provider.id}
                      >
                        {validatingId === provider.id ? "Testing..." : "Validate"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(provider.id, provider.name)}
                        disabled={deletingId === provider.id}
                      >
                        {deletingId === provider.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
