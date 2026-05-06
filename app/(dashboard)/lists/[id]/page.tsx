"use client"
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { DuplicatesTab } from '@/components/lists/DuplicatesTab'
import { EmailCheckerTab } from '@/components/lists/EmailCheckerTab'

interface ListInfo {
  id: string
  name: string
  description?: string
  requireDoubleOptIn: boolean
  createdAt: string
  counts: {
    active: number
    bounced: number
    unsubscribed: number
    pending: number
    undeliverable: number
    total: number
  }
}

interface Contact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  status: string
  createdAt: string
}

interface ContactsMeta {
  page: number
  limit: number
  total: number
}

type TabStatus = 'active' | 'pending' | 'bounced' | 'unsubscribed' | 'undeliverable'
type TabValue = TabStatus | 'duplicates' | 'email-check'

export default function ListDetailPage() {
  const params = useParams() as { id: string }
  const router = useRouter()
  const listId = params.id

  const [listInfo, setListInfo] = useState<ListInfo | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<TabValue>('active')
  const [duplicateGroupCount, setDuplicateGroupCount] = useState<number | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [meta, setMeta] = useState<ContactsMeta>({ page: 1, limit: 50, total: 0 })
  const [contactsLoading, setContactsLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [exporting, setExporting] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addFirstName, setAddFirstName] = useState('')
  const [addLastName, setAddLastName] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const [gdprDeleteContact, setGdprDeleteContact] = useState<Contact | null>(null)
  const [gdprConfirmEmail, setGdprConfirmEmail] = useState('')
  const [gdprDeleting, setGdprDeleting] = useState(false)

  const [togglingOptIn, setTogglingOptIn] = useState(false)

  const { toast } = useToast()

  async function handleGdprExport(contact: Contact) {
    try {
      const res = await fetch(`/api/internal/contacts/${contact.id}/gdpr-export`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'Export failed', variant: 'destructive' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contact-${contact.id}-export.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Export downloaded' })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    }
  }

  async function handleGdprDelete() {
    if (!gdprDeleteContact) return
    if (gdprConfirmEmail.trim().toLowerCase() !== gdprDeleteContact.email.toLowerCase()) {
      toast({ title: 'Email confirmation does not match', variant: 'destructive' })
      return
    }
    setGdprDeleting(true)
    try {
      const url = `/api/internal/contacts/${gdprDeleteContact.id}/gdpr-delete?confirm=${encodeURIComponent(gdprDeleteContact.email)}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'Delete failed', variant: 'destructive' })
        return
      }
      toast({ title: 'Contact and all related data deleted' })
      setGdprDeleteContact(null)
      setGdprConfirmEmail('')
      fetchContacts()
      const listRes = await fetch(`/api/internal/lists/${listId}`)
      if (listRes.ok) setListInfo(await listRes.json())
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    } finally {
      setGdprDeleting(false)
    }
  }

  async function handleToggleDoubleOptIn() {
    if (!listInfo) return
    const next = !listInfo.requireDoubleOptIn
    setTogglingOptIn(true)
    try {
      const res = await fetch(`/api/internal/lists/${listId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireDoubleOptIn: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'Failed to update list', variant: 'destructive' })
        return
      }
      const updated = await res.json()
      setListInfo({ ...listInfo, requireDoubleOptIn: updated.requireDoubleOptIn })
      toast({
        title: next ? 'Double opt-in enabled' : 'Double opt-in disabled',
        description: next
          ? 'New contacts will be sent a confirmation email.'
          : 'New contacts will be marked active immediately.',
      })
    } catch {
      toast({ title: 'Failed to update list', variant: 'destructive' })
    } finally {
      setTogglingOptIn(false)
    }
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAddSaving(true)
    try {
      const res = await fetch(`/api/internal/lists/${listId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addEmail.trim(),
          firstName: addFirstName.trim() || undefined,
          lastName: addLastName.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast({ title: data.error || 'Failed to add contact', variant: 'destructive' })
        return
      }
      toast({ title: 'Contact added' })
      setAddOpen(false)
      setAddEmail('')
      setAddFirstName('')
      setAddLastName('')
      fetchContacts()
      // Refresh list info to update counts
      const listRes = await fetch(`/api/internal/lists/${listId}`)
      if (listRes.ok) setListInfo(await listRes.json())
    } catch {
      toast({ title: 'Failed to add contact', variant: 'destructive' })
    } finally {
      setAddSaving(false)
    }
  }

  // Fetch list info
  useEffect(() => {
    async function fetchList() {
      setListLoading(true)
      setListError(null)
      try {
        const res = await fetch(`/api/internal/lists/${listId}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setListError(body.error || 'Failed to load list.')
          return
        }
        const data = await res.json()
        setListInfo(data)
      } catch {
        setListError('Failed to load list.')
      } finally {
        setListLoading(false)
      }
    }
    fetchList()
  }, [listId])

  // Fetch duplicate group count for the badge
  const fetchDuplicateCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/internal/lists/${listId}/duplicates`)
      if (!res.ok) return
      const json = await res.json()
      setDuplicateGroupCount(json.meta?.groupCount ?? 0)
    } catch {
      // ignore
    }
  }, [listId])

  useEffect(() => {
    fetchDuplicateCount()
  }, [fetchDuplicateCount])

  // Fetch contacts whenever tab, page, or search changes
  const fetchContacts = useCallback(async () => {
    if (activeTab === 'duplicates' || activeTab === 'email-check') {
      return
    }
    setContactsLoading(true)
    try {
      const params = new URLSearchParams({
        status: activeTab,
        page: String(page),
        limit: '50',
      })
      if (search) {
        params.set('search', search)
      }
      const res = await fetch(`/api/internal/lists/${listId}/contacts?${params.toString()}`)
      if (!res.ok) return
      const json = await res.json()
      setContacts(json.data || [])
      setMeta(json.meta || { page: 1, limit: 50, total: 0 })
    } catch {
      // silently fail, table stays empty
    } finally {
      setContactsLoading(false)
    }
  }, [listId, activeTab, page, search])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  function handleTabChange(value: string) {
    setActiveTab(value as TabValue)
    setPage(1)
    setSearchInput('')
    setSearch('')
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      setSearch(searchInput.trim())
      setPage(1)
    }
  }

  function handleSearchClear() {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(`/api/internal/lists/${listId}/export`)
      if (!res.ok) {
        alert('Export failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contacts-${listId}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit))

  if (listLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading list...</div>
    )
  }

  if (listError) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">{listError}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/lists')}>
          Back to Lists
        </Button>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/lists" className="hover:text-primary transition-colors">Lists</Link>
            <span>/</span>
            <span>{listInfo?.name}</span>
          </div>
          <h1 className="text-2xl font-bold font-heading">{listInfo?.name}</h1>
          {listInfo?.description && (
            <p className="text-sm text-muted-foreground mt-1">{listInfo.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="secondary">{listInfo?.counts.total ?? 0} total</Badge>
            <Badge variant="default">{listInfo?.counts.active ?? 0} active</Badge>
            {(listInfo?.counts.pending ?? 0) > 0 && (
              <Badge variant="outline">{listInfo?.counts.pending} pending</Badge>
            )}
            {(listInfo?.counts.bounced ?? 0) > 0 && (
              <Badge variant="destructive">{listInfo?.counts.bounced} bounced</Badge>
            )}
            {(listInfo?.counts.undeliverable ?? 0) > 0 && (
              <Badge variant="destructive">{listInfo?.counts.undeliverable} undeliverable</Badge>
            )}
            {(listInfo?.counts.unsubscribed ?? 0) > 0 && (
              <Badge variant="outline">{listInfo?.counts.unsubscribed} unsubscribed</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3 rounded-md border bg-card px-3 py-2 max-w-md">
            <button
              type="button"
              role="switch"
              aria-checked={!!listInfo?.requireDoubleOptIn}
              disabled={togglingOptIn || !listInfo}
              onClick={handleToggleDoubleOptIn}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                listInfo?.requireDoubleOptIn ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                  listInfo?.requireDoubleOptIn ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <div className="text-sm">
              <div className="font-medium">
                Double opt-in {listInfo?.requireDoubleOptIn ? 'enabled' : 'disabled'}
                {togglingOptIn && (
                  <span className="ml-2 text-xs text-muted-foreground">Updating...</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {listInfo?.requireDoubleOptIn
                  ? 'New contacts must confirm by email before they can be sent campaigns.'
                  : 'New contacts are added as active and can receive campaigns immediately.'}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Add Contact</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Contact</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddContact} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="add-email">Email *</Label>
                  <Input
                    id="add-email"
                    type="email"
                    placeholder="john@example.com"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="add-first-name">First Name</Label>
                    <Input
                      id="add-first-name"
                      placeholder="John"
                      value={addFirstName}
                      onChange={(e) => setAddFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-last-name">Last Name</Label>
                    <Input
                      id="add-last-name"
                      placeholder="Doe"
                      value={addLastName}
                      onChange={(e) => setAddLastName(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={addSaving || !addEmail.trim()}>
                    {addSaving ? 'Adding...' : 'Add Contact'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button asChild>
            <Link href={`/lists/${listId}/upload`}>Upload Contacts</Link>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="active">
            Active
            <Badge variant="secondary" className="ml-2">
              {listInfo?.counts.active ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pending">
            Pending
            <Badge variant="secondary" className="ml-2">
              {listInfo?.counts.pending ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="bounced">
            Bounced
            <Badge variant="secondary" className="ml-2">
              {listInfo?.counts.bounced ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="undeliverable">
            Undeliverable
            <Badge variant="secondary" className="ml-2">
              {listInfo?.counts.undeliverable ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="unsubscribed">
            Unsubscribed
            <Badge variant="secondary" className="ml-2">
              {listInfo?.counts.unsubscribed ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="duplicates">
            Duplicates
            <Badge
              variant={duplicateGroupCount && duplicateGroupCount > 0 ? 'destructive' : 'secondary'}
              className="ml-2"
            >
              {duplicateGroupCount ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="email-check">Email Checker</TabsTrigger>
        </TabsList>

        {(['active', 'pending', 'bounced', 'undeliverable', 'unsubscribed'] as TabStatus[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-4">
            {/* Search bar */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search by email, press Enter to search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="max-w-sm"
              />
              {search && (
                <Button variant="ghost" size="sm" onClick={handleSearchClear}>
                  Clear
                </Button>
              )}
            </div>

            {/* Table */}
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactsLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                        Loading contacts...
                      </TableCell>
                    </TableRow>
                  ) : contacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                        {search
                          ? 'No contacts match your search.'
                          : `No ${tab} contacts in this list.`}
                      </TableCell>
                    </TableRow>
                  ) : (
                    contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.email}</TableCell>
                        <TableCell>{contact.firstName || '-'}</TableCell>
                        <TableCell>{contact.lastName || '-'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(contact.createdAt), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2">
                                <span aria-hidden>...</span>
                                <span className="sr-only">Open contact actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => handleGdprExport(contact)}>
                                Export GDPR data
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  setGdprDeleteContact(contact)
                                  setGdprConfirmEmail('')
                                }}
                              >
                                Delete (GDPR)
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {meta.total === 0
                  ? 'No contacts'
                  : `${meta.total} contact${meta.total !== 1 ? 's' : ''} total`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || contactsLoading}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground px-2">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || contactsLoading}
                >
                  Next
                </Button>
              </div>
            </div>
          </TabsContent>
        ))}

        <TabsContent value="email-check" className="space-y-4">
          <EmailCheckerTab listId={listId} />
        </TabsContent>

        <TabsContent value="duplicates" className="space-y-4">
          <DuplicatesTab
            listId={listId}
            onMergedChange={async () => {
              await Promise.all([
                (async () => {
                  const listRes = await fetch(`/api/internal/lists/${listId}`)
                  if (listRes.ok) setListInfo(await listRes.json())
                })(),
                fetchDuplicateCount(),
              ])
            }}
          />
        </TabsContent>
      </Tabs>

      <Dialog
        open={gdprDeleteContact !== null}
        onOpenChange={(open) => {
          if (!open) {
            setGdprDeleteContact(null)
            setGdprConfirmEmail('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard delete contact (GDPR)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              This will permanently delete <span className="font-mono">{gdprDeleteContact?.email}</span> and all associated send and engagement records. This cannot be undone.
            </p>
            <p className="text-muted-foreground">
              Type the email below to confirm.
            </p>
            <Input
              placeholder={gdprDeleteContact?.email ?? ''}
              value={gdprConfirmEmail}
              onChange={(e) => setGdprConfirmEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGdprDeleteContact(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                gdprDeleting ||
                !gdprDeleteContact ||
                gdprConfirmEmail.trim().toLowerCase() !== gdprDeleteContact.email.toLowerCase()
              }
              onClick={handleGdprDelete}
            >
              {gdprDeleting ? 'Deleting...' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
