'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'

interface ListWithCounts {
  id: string
  name: string
  description: string | null
  requireDoubleOptIn: boolean
  createdAt: string
  total: number
  active: number
  bounced: number
  unsubscribed: number
  pending: number
  undeliverable: number
}

export default function ListsPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [lists, setLists] = useState<ListWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newRequireDoubleOptIn, setNewRequireDoubleOptIn] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function fetchLists() {
    try {
      const res = await fetch('/api/internal/lists')
      if (!res.ok) throw new Error('Failed to fetch lists')
      const data = await res.json()
      setLists(data)
    } catch {
      toast({ title: 'Error', description: 'Could not load lists.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLists()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/internal/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          requireDoubleOptIn: newRequireDoubleOptIn,
        }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to create list')
      }
      toast({ title: 'List created', description: `"${newName.trim()}" has been created.` })
      setNewName('')
      setNewDescription('')
      setNewRequireDoubleOptIn(false)
      setDialogOpen(false)
      await fetchLists()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create list.'
      toast({ title: 'Error', description: message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/internal/lists/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to delete list')
      }
      toast({ title: 'List deleted', description: `"${name}" has been deleted.` })
      await fetchLists()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete list.'
      toast({ title: 'Error', description: message, variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading">Lists</h1>
        <div className="flex items-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/lists/duplicates">Cross-list duplicates</Link>
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>New List</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create a new list</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="list-name">Name</Label>
                <Input
                  id="list-name"
                  placeholder="e.g. Newsletter subscribers"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="list-description">Description (optional)</Label>
                <Input
                  id="list-description"
                  placeholder="A short description of this list"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="flex items-start gap-2 rounded-md border p-3">
                <input
                  id="list-double-opt-in"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  checked={newRequireDoubleOptIn}
                  onChange={(e) => setNewRequireDoubleOptIn(e.target.checked)}
                  disabled={submitting}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="list-double-opt-in" className="font-medium">
                    Require double opt-in
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    New contacts will receive a confirmation email and must click the link before they can be sent campaigns.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !newName.trim()}>
                  {submitting ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
          </div>
          <p className="text-sm text-muted-foreground">
            No lists yet. Create your first list to start collecting contacts.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>List Name</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Bounced</TableHead>
                <TableHead className="text-right">Undeliverable</TableHead>
                <TableHead className="text-right">Unsubscribed</TableHead>
                <TableHead>Created Date</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button
                        className="font-medium text-left hover:text-primary transition-colors focus:outline-none"
                        onClick={() => router.push(`/lists/${list.id}`)}
                      >
                        {list.name}
                      </button>
                      {list.requireDoubleOptIn && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Double opt-in
                        </Badge>
                      )}
                    </div>
                    {list.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{list.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{list.total ?? 0}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">{list.active ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-sky-600 dark:text-sky-400 font-medium">{list.pending ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-red-600 dark:text-red-400 font-medium">{list.bounced ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">{list.undeliverable ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">{list.unsubscribed ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(list.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletingId === list.id}
                      onClick={() => handleDelete(list.id, list.name)}
                    >
                      {deletingId === list.id ? 'Deleting...' : 'Delete'}
                    </Button>
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
