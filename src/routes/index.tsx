import { createFileRoute } from '@tanstack/react-router'
import { preloadPatient, requireEhr, searchQuery } from '@/hooks/ehr'
import { HomePage } from '@/pages/home'

export const Route = createFileRoute('/')({
  // Fetch the EHR data before the page appears, so it shows without a loading flicker.
  // Needs a session: opened directly, or after it ended, the visitor goes to /not-launched.
  loader: async ({ context: { queryClient } }) => {
    await requireEhr(queryClient)
    await Promise.all([
      preloadPatient(queryClient),
      queryClient.prefetchQuery(searchQuery('Encounter')),
    ])
  },
  component: HomePage,
})
