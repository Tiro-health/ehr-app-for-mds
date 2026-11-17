import { createFileRoute } from '@tanstack/react-router'
import { preloadPatient, requireLaunch, searchQuery } from '@/hooks/ehr'
import { HomePage } from '@/pages/home'

export const Route = createFileRoute('/')({
  // Fetch the EHR data before the page appears, so it shows without a loading flicker.
  // Opened directly, or after the session ended: go to the page that says to open it from the EHR.
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      preloadPatient(queryClient),
      queryClient.prefetchQuery(searchQuery('Encounter')),
    ])
    requireLaunch(queryClient)
  },
  component: HomePage,
})
