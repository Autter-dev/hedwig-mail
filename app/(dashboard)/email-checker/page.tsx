import { EmailCheckerScreen } from '@/components/email-checker/EmailCheckerScreen'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function EmailCheckerPage({
  searchParams,
}: {
  searchParams: { listId?: string }
}) {
  const listId = searchParams.listId && UUID_RE.test(searchParams.listId) ? searchParams.listId : undefined

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading">Email Checker</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verify addresses with syntax, MX, and SMTP checks without sending any email, then remove the ones that
          will not deliver.
        </p>
      </div>
      <EmailCheckerScreen initialListId={listId} />
    </div>
  )
}
