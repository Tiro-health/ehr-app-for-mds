import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { ehrContext, ehrRead, ehrSearch } from '@/lib/ehr.functions'
import type { Encounter, Patient } from 'fhir/r4'
import patient from '../../fixtures/r4/Patient-patient-1.json'
import encounter1 from '../../fixtures/r4/Encounter-encounter-1.json'
import encounter2 from '../../fixtures/r4/Encounter-encounter-2.json'
import encounter3 from '../../fixtures/r4/Encounter-encounter-3.json'
import { HomePage } from './home'

vi.mock('@/lib/app-state.functions', () => ({
  appStateRead: vi.fn().mockResolvedValue({ launched: false }),
  appStateWrite: vi.fn(),
}))
vi.mock('@/lib/ehr.functions', () => ({
  ehrContext: vi.fn(),
  ehrRead: vi.fn(),
  ehrSearch: vi.fn(),
  ehrCreate: vi.fn(),
  ehrUpdate: vi.fn(),
  ehrDelete: vi.fn(),
}))

const encounters = [encounter1, encounter2, encounter3] as Encounter[]

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  )
}

test('shows the app name when opened without the EHR', async () => {
  vi.mocked(ehrContext).mockResolvedValue({ launched: false })
  vi.mocked(ehrSearch).mockResolvedValue({ launched: false })
  renderHome()

  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  expect(screen.queryByText('Opened from the EHR')).not.toBeInTheDocument()
})

test('shows the patient and encounters when opened from the EHR', async () => {
  vi.mocked(ehrContext).mockResolvedValue({
    launched: true,
    data: {
      patient: 'patient-1',
      encounter: null,
      practitioner: null,
      fhirUser: null,
      fhirVersion: 'R4',
      scopes: [],
      intent: null,
    },
  })
  vi.mocked(ehrRead).mockResolvedValue({
    launched: true,
    data: patient as Patient,
  })
  vi.mocked(ehrSearch).mockResolvedValue({
    launched: true,
    data: { matches: encounters, included: [] },
  })
  renderHome()

  expect(await screen.findByText('Jeanne Voorbeeld')).toBeInTheDocument()
  const list = await screen.findByRole('list', { name: 'Encounters' })
  expect(list.children).toHaveLength(3)
  // The page said what it wanted; the server functions know no resource type.
  expect(ehrRead).toHaveBeenCalledWith({
    data: { type: 'Patient', id: 'patient-1' },
  })
  expect(vi.mocked(ehrSearch).mock.calls[0]?.[0]).toMatchObject({
    data: { type: 'Encounter' },
  })
})
