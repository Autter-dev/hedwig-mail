'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'

interface DupContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  metadata: Record<string, string>
  status: string
  updatedAt: string
  createdAt: string
  completeness: number
  campaignSendCount: number
}

interface DupGroup {
  normEmail: string
  suggestedWinnerId: string
  contacts: DupContact[]
}

interface Props {
  listId: string
  onMergedChange?: () => void
}

const STATUS_RANK: Record<string, number> = {
  unsubscribed: 4,
  bounced: 3,
  undeliverable: 2,
  pending: 1,
  active: 0,
}

function previewMerged(group: DupGroup, winnerId: string): {
  firstName: string
  lastName: string
  status: string
  metadata: Record<string, string>
} {
  const winner = group.contacts.find((c) => c.id === winnerId) ?? group.contacts[0]
  const losers = group.contacts.filter((c) => c.id !== winnerId)

  const firstNonEmpty = (vals: (string | null | undefined)[]) => {
    for (const v of vals) if (v && v.trim().length > 0) return v
    return ''
  }

  const firstName = firstNonEmpty([winner.firstName, ...losers.map((l) => l.firstName)])
  const lastName = firstNonEmpty([winner.lastName, ...losers.map((l) => l.lastName)])

  const metadata: Record<string, string> = {}
  for (const c of [...losers, winner]) {
    for (const [k, v] of Object.entries(c.metadata ?? {})) {
      if (v !== null && v !== undefined && String(v).length > 0) metadata[k] = String(v)
    }
  }

  let worst = 'active'
  let worstRank = -1
  for (const c of group.contacts) {
    const rank = STATUS_RANK[c.status] ?? 0
    if (rank > worstRank) {
      worstRank = rank
      worst = c.status
    }
  }

  return { firstName, lastName, status: worst, metadata }
}

function statusVariant(s: string): 'default' | 'destructive' | 'outline' | 'secondary' {
  if (s === 'bounced') return 'destructive'
  if (s === 'undeliverable') return 'destructive'
  if (s === 'unsubscribed') return 'outline'
  if (s === 'active') return 'default'
  return 'secondary'
}

export function DuplicatesTab({ listId, onMergedChange }: Props) {
  const { toast } = useToast()
  const [groups, setGroups] = useState<DupGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [winners, setWinners] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState(false)
  const [confirmGroups, setConfirmGroups] = useState<DupGroup[] | null>(null)

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/internal/lists/${listId}/duplicates`)
      if (!res.ok) {
        setGroups([])
        return
      }
      const json = await res.json()
      const fetched: DupGroup[] = json.data || []
      setGroups(fetched)
      setWinners((prev) => {
        const next = { ...prev }
        for (const g of fetched) {
          if (!next[g.normEmail]) next[g.normEmail] = g.suggestedWinnerId
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  function setWinner(normEmail: string, winnerId: string) {
    setWinners((prev) => ({ ...prev, [normEmail]: winnerId }))
  }

  async function performMerge(targetGroups: DupGroup[]) {
    setMerging(true)
    try {
      const payload = {
        groups: targetGroups.map((g) => {
          const winnerId = winners[g.normEmail] ?? g.suggestedWinnerId
          return {
            winnerId,
            loserIds: g.contacts.filter((c) => c.id !== winnerId).map((c) => c.id),
          }
        }),
      }
      const res = await fetch(`/api/internal/lists/${listId}/duplicates/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'Merge failed', variant: 'destructive' })
        return
      }
      const result = await res.json()
      if (result.errors?.length) {
        toast({
          title: `Merged ${result.merged}, ${result.errors.length} failed`,
          description: result.errors.map((e: { message: string }) => e.message).join(', '),
          variant: 'destructive',
        })
      } else {
        toast({
          title: `Merged ${result.merged} group${result.merged === 1 ? '' : 's'}`,
          description: `${result.reassignedSends} send${result.reassignedSends === 1 ? '' : 's'} reassigned, ${result.droppedSends} dropped.`,
        })
      }
      setConfirmGroups(null)
      await fetchGroups()
      onMergedChange?.()
    } catch {
      toast({ title: 'Merge failed', variant: 'destructive' })
    } finally {
      setMerging(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Scanning for duplicates...</div>
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">No duplicates detected in this list.</p>
        <p className="text-xs text-muted-foreground mt-2">
          Duplicates are detected by comparing emails after lowercasing and trimming whitespace.
        </p>
      </div>
    )
  }

  const totalLosers = groups.reduce((acc, g) => acc + g.contacts.length - 1, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {groups.length} duplicate group{groups.length !== 1 ? 's' : ''}, {totalLosers} contact{totalLosers !== 1 ? 's' : ''} would be removed.
        </div>
        <Button
          onClick={() => setConfirmGroups(groups)}
          disabled={merging}
        >
          Merge all
        </Button>
      </div>

      {groups.map((group) => {
        const winnerId = winners[group.normEmail] ?? group.suggestedWinnerId
        const merged = previewMerged(group, winnerId)
        return (
          <div key={group.normEmail} className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm">{group.normEmail}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {group.contacts.length} entries
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => setConfirmGroups([group])}
                disabled={merging}
              >
                Merge group
              </Button>
            </div>

            <div className="rounded-md border divide-y">
              {group.contacts.map((c) => {
                const isWinner = c.id === winnerId
                return (
                  <label
                    key={c.id}
                    className={`flex items-start gap-3 p-3 cursor-pointer ${
                      isWinner ? 'bg-muted/40' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name={`winner-${group.normEmail}`}
                      className="mt-1.5"
                      checked={isWinner}
                      onChange={() => setWinner(group.normEmail, c.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.email}</span>
                        <Badge variant={statusVariant(c.status)} className="text-[10px] px-1.5 py-0">
                          {c.status}
                        </Badge>
                        {isWinner && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            winner
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>First: {c.firstName || '-'}</span>
                        <span>Last: {c.lastName || '-'}</span>
                        <span>Updated: {format(new Date(c.updatedAt), 'MMM d, yyyy HH:mm')}</span>
                        <span>{c.campaignSendCount} send{c.campaignSendCount === 1 ? '' : 's'}</span>
                        {Object.keys(c.metadata ?? {}).length > 0 && (
                          <span>Metadata keys: {Object.keys(c.metadata).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium mb-1">Merged result preview</div>
              <div className="text-muted-foreground space-y-0.5">
                <div>Email: <span className="font-mono">{group.contacts.find((c) => c.id === winnerId)?.email}</span></div>
                <div>First: {merged.firstName || '-'}</div>
                <div>Last: {merged.lastName || '-'}</div>
                <div>Status: {merged.status}</div>
                {Object.keys(merged.metadata).length > 0 && (
                  <div>Metadata: {Object.entries(merged.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}</div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <Dialog
        open={confirmGroups !== null}
        onOpenChange={(open) => {
          if (!open && !merging) setConfirmGroups(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm merge</DialogTitle>
          </DialogHeader>
          {confirmGroups && (
            <div className="space-y-2 text-sm">
              <p>
                Merging {confirmGroups.length} group{confirmGroups.length === 1 ? '' : 's'}.
                {' '}
                {confirmGroups.reduce((acc, g) => acc + g.contacts.length - 1, 0)} contact rows will be deleted.
              </p>
              <p className="text-muted-foreground text-xs">
                Campaign send history (opens, clicks, bounces) is reassigned to the winner. If the winner already has a row for the same campaign, the loser&apos;s row for that campaign is dropped to satisfy the unique constraint.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmGroups(null)} disabled={merging}>
              Cancel
            </Button>
            <Button
              onClick={() => confirmGroups && performMerge(confirmGroups)}
              disabled={merging}
            >
              {merging ? 'Merging...' : 'Confirm merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
