import { createFileRoute } from '@tanstack/react-router'
import { encountersQuery, patientQuery } from '@/hooks/ehr'
import { HomePage } from '@/pages/home'

export const Route = createFileRoute('/')({
  // Fetch the EHR data before the page appears, so it shows without a loading flicker.
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(patientQuery),
      queryClient.prefetchQuery(encountersQuery),
    ]),
  component: HomePage,
})
