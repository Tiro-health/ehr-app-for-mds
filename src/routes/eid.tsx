import { createFileRoute } from '@tanstack/react-router'
import { preloadPatient, requireEhr } from '@/hooks/ehr'
import { EidPage } from '@/pages/eid'

export const Route = createFileRoute('/eid')({
  // Needs the patient that is open in the EHR: the card is compared with that patient.
  // Opened directly, or without a patient, the visitor goes to /not-launched.
  loader: async ({ context: { queryClient } }) => {
    await requireEhr(queryClient, { scopes: ['patient/Patient.rs'] })
    await preloadPatient(queryClient)
  },
  component: EidPage,
})
