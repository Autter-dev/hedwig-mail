"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { BlockEditor } from "@/components/editor/BlockEditor"
import { HtmlEditor } from "@/components/editor/HtmlEditor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Block } from "@/lib/db/schema"

type EditorMode = "visual" | "code"

interface Provider {
  id: string
  name: string
  type: string
}

interface Campaign {
  id: string
  name: string
  subject: string
  fromName: string
  fromEmail: string
  replyToEmail: string | null
  listId: string
  providerId: string | null
  templateJson: Block[]
  templateHtml: string | null
  status: string
}

export default function EditorPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const campaignId = params.campaignId as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Editor mode
  const [editorMode, setEditorMode] = useState<EditorMode>("visual")

  // Editable fields
  const [name, setName] = useState("")
  const [subject, setSubject] = useState("")
  const [fromName, setFromName] = useState("")
  const [fromEmail, setFromEmail] = useState("")
  const [replyToEmail, setReplyToEmail] = useState("")
  const [providerId, setProviderId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [templateHtml, setTemplateHtml] = useState("")

  // Providers
  const [providers, setProviders] = useState<Provider[]>([])

  // Test send
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testEmail, setTestEmail] = useState("")
  const [sendingTest, setSendingTest] = useState(false)

  // Save as template
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState("")
  const [templateDescriptionInput, setTemplateDescriptionInput] = useState("")
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Merge tags
  const [mergeTags, setMergeTags] = useState<{ tag: string; description: string }[]>([])

  // Auto-save timer
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasChangesRef = useRef(false)

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await fetch(`/api/internal/campaigns/${campaignId}`)
      if (!res.ok) {
        toast({ title: "Error", description: "Campaign not found", variant: "destructive" })
        router.push("/campaigns")
        return
      }
      const data = await res.json()
      setCampaign(data)
      setName(data.name)
      setSubject(data.subject || "")
      setFromName(data.fromName || "")
      setFromEmail(data.fromEmail || "")
      setReplyToEmail(data.replyToEmail || "")
      setProviderId(data.providerId || null)
      setBlocks(data.templateJson || [])
      setTemplateHtml(data.templateHtml || "")
      // If campaign has custom HTML but no blocks, default to code mode
      if (data.templateHtml && (!data.templateJson || data.templateJson.length === 0)) {
        setEditorMode("code")
      }
    } catch {
      toast({ title: "Error", description: "Failed to load campaign", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [campaignId, router, toast])

  useEffect(() => {
    fetchCampaign()
  }, [fetchCampaign])

  // Fetch merge tags when campaign loads
  useEffect(() => {
    if (!campaign?.listId) return
    async function fetchMergeTags() {
      try {
        const res = await fetch(`/api/internal/lists/${campaign!.listId}/merge-tags`)
        if (res.ok) setMergeTags(await res.json())
      } catch {
        // fall back to empty
      }
    }
    fetchMergeTags()
  }, [campaign?.listId])

  // Fetch providers
  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch("/api/internal/providers")
        if (res.ok) setProviders(await res.json())
      } catch {
        // fall back to empty
      }
    }
    fetchProviders()
  }, [])

  const saveDraft = useCallback(async () => {
    if (!campaign) return
    setSaving(true)
    try {
      const res = await fetch(`/api/internal/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject,
          fromName,
          fromEmail,
          replyToEmail: replyToEmail || null,
          providerId,
          templateJson: blocks,
          templateHtml: templateHtml || null,
        }),
      })
      if (!res.ok) throw new Error("Save failed")
      hasChangesRef.current = false
      toast({ title: "Saved", description: "Draft saved successfully" })
    } catch {
      toast({ title: "Error", description: "Failed to save draft", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [campaign, campaignId, name, subject, fromName, fromEmail, replyToEmail, providerId, blocks, templateHtml, editorMode, toast])

  // Auto-save every 30 seconds
  useEffect(() => {
    autoSaveRef.current = setInterval(() => {
      if (hasChangesRef.current && campaign) {
        saveDraft()
      }
    }, 30000)

    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current)
    }
  }, [saveDraft, campaign])

  // Track changes
  useEffect(() => {
    if (campaign) {
      hasChangesRef.current = true
    }
  }, [name, subject, fromName, fromEmail, replyToEmail, providerId, blocks, templateHtml, campaign])

  const handleTestSend = async () => {
    if (!testEmail) return
    setSendingTest(true)
    try {
      const res = await fetch(`/api/internal/campaigns/${campaignId}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: testEmail }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to send test email", variant: "destructive" })
        return
      }
      const sentList: string[] = data.sent || []
      const failedList: { email: string; error: string }[] = data.failed || []
      const sentMsg = sentList.length > 0
        ? `Sent to ${sentList.length} recipient${sentList.length === 1 ? "" : "s"}: ${sentList.join(", ")}`
        : "Sent"
      if (failedList.length > 0) {
        toast({
          title: "Partial success",
          description: `${sentMsg}. Failed: ${failedList.map((f) => f.email).join(", ")}`,
          variant: "destructive",
        })
      } else {
        toast({ title: "Sent", description: sentMsg })
      }
      setTestDialogOpen(false)
      setTestEmail("")
    } catch {
      toast({ title: "Error", description: "Failed to send test email", variant: "destructive" })
    } finally {
      setSendingTest(false)
    }
  }

  const openSaveTemplate = () => {
    setTemplateNameInput(name || "")
    setTemplateDescriptionInput("")
    setSaveTemplateOpen(true)
  }

  const handleSaveAsTemplate = async () => {
    if (!templateNameInput.trim()) {
      toast({ title: "Error", description: "Template name is required", variant: "destructive" })
      return
    }
    setSavingTemplate(true)
    try {
      // Save current edits to the campaign first so the template snapshots the latest content
      await saveDraft()
      const res = await fetch(`/api/internal/campaigns/${campaignId}/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateNameInput.trim(),
          description: templateDescriptionInput.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to save template", variant: "destructive" })
        return
      }
      toast({
        title: "Saved as template",
        description: `Template "${data.name}" created. Find it in the Templates library.`,
      })
      setSaveTemplateOpen(false)
    } catch {
      toast({ title: "Error", description: "Failed to save template", variant: "destructive" })
    } finally {
      setSavingTemplate(false)
    }
  }

  const copyMergeTag = (tag: string) => {
    navigator.clipboard.writeText(tag)
    toast({ title: "Copied", description: `${tag} copied to clipboard` })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading editor...</p>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Campaign not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      {/* Top Bar */}
      <div className="border-b bg-card px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Link
              href={`/campaigns/${campaignId}`}
              className="text-sm text-muted-foreground hover:text-foreground shrink-0"
            >
              &larr; Back
            </Link>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-semibold text-lg border-0 bg-transparent p-0 h-auto focus-visible:ring-0 max-w-xs"
              placeholder="Campaign name"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Send Test
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Send Test Email</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Recipient Emails</Label>
                    <Input
                      type="text"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="test@example.com, another@example.com"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Separate multiple addresses with commas. Up to 10 recipients.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleTestSend}
                    disabled={!testEmail || sendingTest}
                  >
                    {sendingTest ? "Sending..." : "Send Test"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={openSaveTemplate}>
              Save as Template
            </Button>
            <Button onClick={saveDraft} disabled={saving} size="sm">
              {saving ? "Saving..." : "Save Draft"}
            </Button>
          </div>
        </div>

        <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save as Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="save-template-name">Template Name</Label>
                <Input
                  id="save-template-name"
                  value={templateNameInput}
                  onChange={(e) => setTemplateNameInput(e.target.value)}
                  placeholder="e.g. Monthly Newsletter Layout"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="save-template-description">Description (optional)</Label>
                <Input
                  id="save-template-description"
                  value={templateDescriptionInput}
                  onChange={(e) => setTemplateDescriptionInput(e.target.value)}
                  placeholder="Short note about this template"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Snapshots the current subject, sender info, and email content. Saves your draft first.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSaveTemplateOpen(false)}
                disabled={savingTemplate}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveAsTemplate} disabled={savingTemplate}>
                {savingTemplate ? "Saving..." : "Save Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Editor mode toggle + Subject and From fields */}
        <div className="flex items-center gap-1 mt-3 mb-2">
          <button
            onClick={() => setEditorMode("visual")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              editorMode === "visual"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            Visual Editor
          </button>
          <button
            onClick={() => setEditorMode("code")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              editorMode === "code"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            HTML Code
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Subject Line</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">From Name</Label>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Your Name"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">From Email</Label>
            <Input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Reply-To (optional)</Label>
            <Input
              value={replyToEmail}
              onChange={(e) => setReplyToEmail(e.target.value)}
              placeholder="replies@example.com"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Email Provider</Label>
            <Select
              value={providerId || ""}
              onValueChange={(val) => setProviderId(val || null)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden">
        {editorMode === "visual" ? (
          <BlockEditor blocks={blocks} onChange={setBlocks} />
        ) : (
          <HtmlEditor html={templateHtml} onChange={setTemplateHtml} />
        )}
      </div>

      {/* Bottom Bar: Merge Tags */}
      <div className="border-t bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Merge tags:</span>
          {mergeTags.length === 0 ? (
            <span className="text-xs text-muted-foreground">Loading...</span>
          ) : (
            mergeTags.map((item) => (
              <button
                key={item.tag}
                onClick={() => copyMergeTag(item.tag)}
                title={item.description}
                className="text-xs px-2 py-1 bg-primary/10 text-primary hover:bg-primary/20 rounded-md font-mono transition-colors"
              >
                {item.tag}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
