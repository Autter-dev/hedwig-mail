'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ListCleanup } from '@/components/email-checker/ListCleanup'
import { SingleEmailCheck } from '@/components/email-checker/SingleEmailCheck'

interface Props {
  initialListId?: string
}

export function EmailCheckerScreen({ initialListId }: Props) {
  return (
    <Tabs defaultValue="lists" className="space-y-4">
      <TabsList>
        <TabsTrigger value="lists">Clean up lists</TabsTrigger>
        <TabsTrigger value="single">Check one address</TabsTrigger>
      </TabsList>
      <TabsContent value="lists">
        <ListCleanup initialListId={initialListId} />
      </TabsContent>
      <TabsContent value="single">
        <SingleEmailCheck />
      </TabsContent>
    </Tabs>
  )
}
