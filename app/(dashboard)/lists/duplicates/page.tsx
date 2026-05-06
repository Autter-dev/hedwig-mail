'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface CrossListGroup {
  normEmail: string
  lists: Array<{
    contactId: string
    listId: string
    listName: string
    email: string
    status: string
  }>
}

interface Meta {
  page: number
  limit: number
  total: number
}

function statusBadgeVariant(status: string): 'default' | 'destructive' | 'outline' | 'secondary' {
  if (status === 'bounced') return 'destructive'
  if (status === 'undeliverable') return 'destructive'
  if (status === 'unsubscribed') return 'outline'
  if (status === 'active') return 'default'
  return 'secondary'
}

export default function CrossListDuplicatesPage() {
  const [data, setData] = useState<CrossListGroup[]>([])
  const [meta, setMeta] = useState<Meta>({ page: 1, limit: 50, total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/internal/duplicates/cross-list?${params.toString()}`)
      if (!res.ok) {
        setData([])
        return
      }
      const json = await res.json()
      setData(json.data || [])
      setMeta(json.meta || { page: 1, limit: 50, total: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/lists" className="hover:text-primary transition-colors">Lists</Link>
            <span>/</span>
            <span>Cross-list duplicates</span>
          </div>
          <h1 className="text-2xl font-bold font-heading">Cross-list duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Emails that appear in two or more lists. This is informational. To merge contacts within a single list, open that list and use the Duplicates tab.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by email, press Enter to search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSearch(searchInput.trim().toLowerCase())
              setPage(1)
            }
          }}
          className="max-w-sm"
        />
        {search && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput('')
              setSearch('')
              setPage(1)
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="text-right"># of lists</TableHead>
              <TableHead>Per-list status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                  No emails appear in more than one list.
                </TableCell>
              </TableRow>
            ) : (
              data.map((group) => (
                <TableRow key={group.normEmail}>
                  <TableCell className="font-mono text-sm">{group.normEmail}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{group.lists.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {group.lists.map((entry) => (
                        <Link
                          key={entry.contactId}
                          href={`/lists/${entry.listId}`}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors"
                        >
                          <span>{entry.listName}</span>
                          <Badge variant={statusBadgeVariant(entry.status)} className="text-[10px] px-1.5 py-0">
                            {entry.status}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {meta.total === 0
            ? 'No duplicates'
            : `${meta.total} email${meta.total !== 1 ? 's' : ''} appearing in 2+ lists`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
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
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
