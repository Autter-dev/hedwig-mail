"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import { format } from "date-fns"

type Reason = "bounce" | "complaint" | "unsubscribe" | "manual" | "imported"

interface Suppression {
  id: string
  email: string
  reason: Reason
  source: string | null
  createdAt: string
}

interface ListResponse {
  data: Suppression[]
  meta: { page: number; limit: number; total: number }
}

const REASON_LABEL: Record<Reason, string> = {
  bounce: "Bounced",
  complaint: "Complained",
  unsubscribe: "Unsubscribed",
  manual: "Manual",
  imported: "Imported",
}

function reasonBadgeClass(reason: Reason): string {
  switch (reason) {
    case "bounce":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
    case "complaint":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
    case "unsubscribe":
      return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
    case "manual":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "imported":
      return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
  }
}

const PAGE_SIZE = 50

export default function SuppressionsPage() {
  const { toast } = useToast()

  const [data, setData] = useState<Suppression[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [reasonFilter, setReasonFilter] = useState<Reason | "all">("all")

  const [addOpen, setAddOpen] = useState(false)
  const [addEmail, setAddEmail] = useState("")
  const [addReason, setAddReason] = useState<Reason>("manual")
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (search) params.set("search", search)
      if (reasonFilter !== "all") params.set("reason", reasonFilter)
      const res = await fetch(`/api/internal/suppressions?${params.toString()}`)
      if (!res.ok) throw new Error()
      const json = (await res.json()) as ListResponse
      setData(json.data)
      setTotal(json.meta.total)
    } catch {
      toast({ title: "Failed to load suppressions", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [page, search, reasonFilter, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAdd = async () => {
    if (!addEmail.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/internal/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addEmail.trim(), reason: addReason, source: "manual" }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast({ title: body.error || "Failed to add suppression", variant: "destructive" })
        return
      }
      toast({ title: "Email suppressed" })
      setAddEmail("")
      setAddReason("manual")
      setAddOpen(false)
      setPage(1)
      fetchData()
    } catch {
      toast({ title: "Failed to add suppression", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/internal/suppressions/${deleteId}`, { method: "DELETE" })
      if (!res.ok) {
        toast({ title: "Failed to remove suppression", variant: "destructive" })
        return
      }
      toast({ title: "Email un-suppressed" })
      fetchData()
    } catch {
      toast({ title: "Failed to remove suppression", variant: "destructive" })
    } finally {
      setDeleteId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">Suppressions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Centralized record of email addresses that should never be sent to. Auto-populated from
            bounces, complaints, and unsubscribes. CSV import supported for historical data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings/suppressions/upload">
            <Button variant="outline">Import CSV</Button>
          </Link>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Add Email</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a suppression</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="suppression-email">Email</Label>
                  <Input
                    id="suppression-email"
                    type="email"
                    placeholder="user@example.com"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  />
                </div>
                <div>
                  <Label htmlFor="suppression-reason">Reason</Label>
                  <Select value={addReason} onValueChange={(v) => setAddReason(v as Reason)}>
                    <SelectTrigger id="suppression-reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="bounce">Bounce</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                      <SelectItem value="unsubscribe">Unsubscribe</SelectItem>
                      <SelectItem value="imported">Imported</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={handleAdd} disabled={saving || !addEmail.trim()}>
                  {saving ? "Saving..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="max-w-sm"
        />
        <Select
          value={reasonFilter}
          onValueChange={(v) => {
            setReasonFilter(v as Reason | "all")
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by reason" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reasons</SelectItem>
            {(Object.keys(REASON_LABEL) as Reason[]).map((r) => (
              <SelectItem key={r} value={r}>
                {REASON_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} total
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.length === 0 ? (
        <div className="border rounded-xl p-8 text-center text-muted-foreground">
          {search || reasonFilter !== "all" ? "No suppressions match your filters." : "No suppressions yet."}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm">{row.email}</TableCell>
                  <TableCell>
                    <Badge className={reasonBadgeClass(row.reason)} variant="secondary">
                      {REASON_LABEL[row.reason] ?? row.reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.source ?? ""}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(row.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive/80"
                      onClick={() => setDeleteId(row.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove suppression</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This email will become eligible to receive campaigns again. Continue?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
