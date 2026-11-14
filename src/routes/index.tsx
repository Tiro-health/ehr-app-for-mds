import { createFileRoute } from '@tanstack/react-router'
import { preloadPatient, searchQuery } from '@/hooks/ehr'
import { HomePage } from '@/pages/home'

export const Route = createFileRoute('/')({
  // Fetch the EHR data before the page appears, so it shows without a loading flicker.
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      preloadPatient(queryClient),
      queryClient.prefetchQuery(searchQuery('Encounter')),
    ]),
  component: HomePage,
})
