import { createFileRoute } from '@tanstack/react-router'
import { preloadPatient, searchQuery } from '@/hooks/ehr'
import { HomePage } from '@/pages/home'

export const Route = createFileRoute('/')({
  // Open to anyone: the first page a visitor lands on, with or without the EHR.
  // Opened from the EHR, the patient's data is fetched before the page appears, so it shows
  // without a loading flicker. Opened directly, the page shows without patient data.
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      preloadPatient(queryClient),
      queryClient.prefetchQuery(searchQuery('Encounter')),
    ])
  },
  component: HomePage,
})
