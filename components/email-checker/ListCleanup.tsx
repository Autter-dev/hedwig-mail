'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'

const ALL_LISTS = '__all__'
const PAGE_SIZE = 50
const POLL_MS = 5000

type Verdict = 'invalid' | 'risky' | 'unknown'

interface ListOption {
  id: string
  name: string
}

interface Summary {
  total: number
  safe: number
  risky: number
  invalid: number
  unknown: number
  unchecked: number
  inProgress: number
  uncheckedIdle: number
}

interface FlaggedContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: string
  listId: string
  listName: string | null
  verdict: Verdict
  checkedAt: string | null
  smtpError: string | null
}

const VERDICTS: Record<Verdict, { label: string; help: string; badge: 'destructive' | 'warning' | 'outline' }> = {
  invalid: {
    label: 'Invalid',
    help: 'The domain or mailbox does not exist. These addresses will bounce and are safe to remove.',
    badge: 'destructive',
  },
  risky: {
    label: 'Risky',
    help: 'Mail may be accepted, but there are risk signals such as a catch-all domain, a disposable inbox, or a full mailbox. Review before removing.',
    badge: 'warning',
  },
  unknown: {
    label: 'Unknown',
    help: 'The mail server did not give a clear answer. Re-verify later before removing these.',
    badge: 'outline',
  },
}

function smtpErrorMessage(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { message?: string; type?: string }
    return parsed.message || parsed.type || ''
  } catch {
    return raw
  }
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value.toLocaleString()}</p>
    </div>
  )
}

interface Props {
  initialListId?: string
}

export function ListCleanup({ initialListId }: Props) {
  const { toast } = useToast()

  const [lists, setLists] = useState<ListOption[]>([])
  const [listId, setListId] = useState<string>(initialListId ?? ALL_LISTS)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [verdict, setVerdict] = useState<Verdict>('invalid')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<FlaggedContact[]>([])
  const [total, setTotal] = useState(0)
  const [loadingRows, setLoadingRows] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [runTotal, setRunTotal] = useState<number | null>(null)
  // Mode is kept after closing so the dialog copy does not change during its exit animation.
  const [removeMode, setRemoveMode] = useState<'selected' | 'all'>('selected')
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeCount, setRemoveCount] = useState(0)
  const [suppress, setSuppress] = useState(false)
  const [removing, setRemoving] = useState(false)

  const scopedListId = listId === ALL_LISTS ? undefined : listId
  const showListColumn = !scopedListId

  useEffect(() => {
    fetch('/api/internal/lists')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ListOption[]) => setLists(data.map((l) => ({ id: l.id, name: l.name }))))
      .catch(() => setLists([]))
  }, [])

  // Request counters drop responses that arrive after a newer request was made.
  const summaryReq = useRef(0)
  const rowsReq = useRef(0)

  const fetchSummary = useCallback(async () => {
    const reqId = ++summaryReq.current
    const params = new URLSearchParams()
    if (scopedListId) params.set('listId', scopedListId)
    const res = await fetch(`/api/internal/email-check/summary?${params.toString()}`)
    if (!res.ok || reqId !== summaryReq.current) return null
    const data = (await res.json()) as Summary
    if (reqId !== summaryReq.current) return null
    setSummary(data)
    return data
  }, [scopedListId])

  const fetchRows = useCallback(async () => {
    const reqId = ++rowsReq.current
    setLoadingRows(true)
    try {
      const params = new URLSearchParams({ verdict, page: String(page), limit: String(PAGE_SIZE) })
      if (scopedListId) params.set('listId', scopedListId)
      if (search) params.set('search', search)
      const res = await fetch(`/api/internal/email-check/contacts?${params.toString()}`)
      const json = res.ok ? await res.json() : null
      if (reqId !== rowsReq.current) return
      setRows(json?.data ?? [])
      setTotal(json?.meta?.total ?? 0)
    } finally {
      if (reqId === rowsReq.current) setLoadingRows(false)
    }
  }, [scopedListId, verdict, page, search])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // While a run is in progress, poll the summary and refresh the table as results land.
  useEffect(() => {
    if (!summary || summary.inProgress === 0) return
    const before = summary.inProgress
    const timer = setTimeout(async () => {
      const next = await fetchSummary()
      if (next && next.inProgress < before) fetchRows()
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [summary, fetchSummary, fetchRows])

  // Any filter change goes back to page 1 with nothing selected.
  function changeFilter(update: () => void) {
    update()
    setPage(1)
    setSelected(new Set())
  }

  function changeList(value: string) {
    changeFilter(() => setListId(value))
    setSummary(null)
    setRunTotal(null)
  }

  async function startRun(scope: 'unchecked' | 'all') {
    setStarting(true)
    try {
      const res = await fetch('/api/internal/email-check/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: scopedListId, scope }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data.error || 'Could not start verification', variant: 'destructive' })
        return
      }
      if (data.queued === 0) {
        toast({ title: 'Nothing to verify', description: 'Every contact in scope is already checked or in progress.' })
      } else {
        toast({
          title: `Verifying ${data.queued.toLocaleString()} contacts`,
          description: data.capped
            ? 'This run was capped. Start another run when it finishes to check the rest.'
            : 'Results appear here as the background worker checks each address.',
        })
        setRunTotal((summary?.inProgress ?? 0) + data.queued)
      }
      await fetchSummary()
    } catch {
      toast({ title: 'Could not start verification', variant: 'destructive' })
    } finally {
      setStarting(false)
    }
  }

  function openRemove(mode: 'selected' | 'all') {
    setRemoveMode(mode)
    setRemoveCount(mode === 'selected' ? selected.size : total)
    setRemoveOpen(true)
  }

  async function confirmRemove() {
    setRemoving(true)
    try {
      const body =
        removeMode === 'selected'
          ? { listId: scopedListId, contactIds: Array.from(selected), suppress }
          : { listId: scopedListId, verdicts: [verdict], suppress }
      const res = await fetch('/api/internal/email-check/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data.error || 'Could not remove contacts', variant: 'destructive' })
        return
      }
      const notes: string[] = []
      if (data.markedElsewhere > 0) {
        notes.push(
          `${data.markedElsewhere.toLocaleString()} ${data.markedElsewhere === 1 ? 'copy' : 'copies'} in other lists marked undeliverable.`,
        )
      }
      if (suppress && data.suppressed > 0) {
        notes.push(`${data.suppressed.toLocaleString()} added to the suppression list.`)
      }
      toast({
        title: `Removed ${data.removed.toLocaleString()} ${data.removed === 1 ? 'contact' : 'contacts'}`,
        description: notes.length > 0 ? notes.join(' ') : undefined,
      })
      setRemoveOpen(false)
      setSelected(new Set())
      const pageEmptied = removeMode === 'all' || rows.length <= data.removed
      if (pageEmptied && page > 1) {
        // Changing the page triggers the row fetch.
        setPage(removeMode === 'all' ? 1 : page - 1)
        await fetchSummary()
      } else {
        await Promise.all([fetchSummary(), fetchRows()])
      }
    } catch {
      toast({ title: 'Could not remove contacts', variant: 'destructive' })
    } finally {
      setRemoving(false)
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) rows.forEach((r) => next.delete(r.id))
      else rows.forEach((r) => next.add(r.id))
      return next
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const checked = summary ? summary.total - summary.unchecked : 0
  const inProgress = summary?.inProgress ?? 0
  const runProgress =
    runTotal && runTotal > 0 ? Math.round(((runTotal - inProgress) / runTotal) * 100) : null
  const scopeLabel = scopedListId
    ? lists.find((l) => l.id === scopedListId)?.name ?? 'this list'
    : 'all lists'

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <Label htmlFor="email-check-list">List</Label>
              <Select value={listId} onValueChange={changeList}>
                <SelectTrigger id="email-check-list" className="w-72">
                  <SelectValue placeholder="Select a list" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LISTS}>All lists</SelectItem>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={starting || !summary || summary.total - summary.inProgress === 0}
                onClick={() => startRun('all')}
              >
                Re-verify all
              </Button>
              <Button
                disabled={starting || !summary || summary.uncheckedIdle === 0}
                onClick={() => startRun('unchecked')}
              >
                {starting
                  ? 'Starting...'
                  : `Verify unchecked${summary && summary.uncheckedIdle > 0 ? ` (${summary.uncheckedIdle.toLocaleString()})` : ''}`}
              </Button>
            </div>
          </div>

          {summary && (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryTile label="Checked" value={checked} />
              <SummaryTile label="Valid" value={summary.safe} tone="text-emerald-600 dark:text-emerald-400" />
              <SummaryTile label="Invalid" value={summary.invalid} tone="text-red-600 dark:text-red-400" />
              <SummaryTile label="Risky" value={summary.risky} tone="text-amber-600 dark:text-amber-400" />
              <SummaryTile label="Unknown" value={summary.unknown} />
              <SummaryTile label="Not checked yet" value={summary.unchecked} tone="text-muted-foreground" />
            </div>
          )}

          {inProgress > 0 && (
            <div className="space-y-2">
              <Progress value={runProgress ?? undefined} className={runProgress === null ? 'animate-pulse' : undefined} />
              <p className="text-sm text-muted-foreground">
                {inProgress.toLocaleString()} {inProgress === 1 ? 'address' : 'addresses'} waiting for the background
                worker. Checks are paced to protect your sending reputation, so large lists take a while. You can leave
                this page and come back.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Covers active, pending, and undeliverable contacts. Bounced and unsubscribed contacts are never mailed, so
            they are not checked. Verification uses the SMTP identity from{' '}
            <Link href="/settings/bounces" className="underline underline-offset-2 hover:text-foreground">
              Settings, Bounces
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border p-1">
            {(Object.keys(VERDICTS) as Verdict[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeFilter(() => setVerdict(v))}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  verdict === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {VERDICTS[v].label}
                {summary ? <span className="ml-1.5 tabular-nums opacity-70">{summary[v].toLocaleString()}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by email, press Enter"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') changeFilter(() => setSearch(searchInput.trim().toLowerCase()))
              }}
              className="w-64"
            />
            {search && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  changeFilter(() => setSearch(''))
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{VERDICTS[verdict].help}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => openRemove('selected')}
          >
            Remove selected{selected.size > 0 ? ` (${selected.size.toLocaleString()})` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={total === 0 || !!search}
            title={search ? 'Clear the search to remove every match' : undefined}
            onClick={() => openRemove('all')}
          >
            Remove all {VERDICTS[verdict].label.toLowerCase()} ({total.toLocaleString()})
          </Button>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="h-4 w-4 rounded border-input"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    disabled={rows.length === 0}
                  />
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                {showListColumn && <TableHead>List</TableHead>}
                <TableHead>Verdict</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRows ? (
                <TableRow>
                  <TableCell colSpan={showListColumn ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showListColumn ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">
                    {search
                      ? 'No matching addresses.'
                      : `No ${VERDICTS[verdict].label.toLowerCase()} addresses in ${scopeLabel}.`}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const name = [row.firstName, row.lastName].filter(Boolean).join(' ')
                  const reason = smtpErrorMessage(row.smtpError)
                  return (
                    <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.email}`}
                          className="h-4 w-4 rounded border-input"
                          checked={selected.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{row.email}</TableCell>
                      <TableCell className="text-sm">{name}</TableCell>
                      {showListColumn && (
                        <TableCell className="text-sm">
                          <Link href={`/lists/${row.listId}`} className="hover:text-primary transition-colors">
                            {row.listName ?? 'Unknown list'}
                          </Link>
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={VERDICTS[row.verdict]?.badge ?? 'outline'}>
                          {VERDICTS[row.verdict]?.label ?? row.verdict}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={reason}>
                        {reason}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {row.checkedAt ? formatDistanceToNow(new Date(row.checkedAt), { addSuffix: true }) : ''}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages}, {total.toLocaleString()} addresses
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {removeCount.toLocaleString()} {removeCount === 1 ? 'contact' : 'contacts'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p>
              {removeMode === 'selected'
                ? `The selected ${removeCount === 1 ? 'contact is' : 'contacts are'} permanently deleted from ${scopeLabel}.`
                : `Every ${VERDICTS[verdict].label.toLowerCase()} contact in ${scopeLabel} is permanently deleted.`}{' '}
              Their send and engagement history is removed too. This cannot be undone.
            </p>
            <p className="text-muted-foreground">
              If the same address is in any other list, that copy is kept but marked undeliverable, so it stops
              receiving campaigns everywhere.
            </p>
            <div className="flex items-start gap-2 rounded-md border p-3">
              <input
                id="email-check-suppress"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-input"
                checked={suppress}
                onChange={(e) => setSuppress(e.target.checked)}
                disabled={removing}
              />
              <div className="space-y-0.5">
                <Label htmlFor="email-check-suppress" className="font-medium">
                  Also add to the suppression list
                </Label>
                <p className="text-xs text-muted-foreground">
                  Stops these addresses from being mailed if they are imported again, in any list.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemove} disabled={removing || removeCount === 0}>
              {removing ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
