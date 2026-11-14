import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { ehrContext, ehrRead, ehrSearch } from '@/lib/ehr.functions'
import { encounters, patients } from '../../dev/synthetic-data.mjs'
import { HomePage } from './home'

vi.mock('@/lib/ehr.functions', () => ({
  ehrContext: vi.fn(),
  ehrRead: vi.fn(),
  ehrSearch: vi.fn(),
  ehrCreate: vi.fn(),
  ehrUpdate: vi.fn(),
  ehrDelete: vi.fn(),
}))

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
      patient: patients[0]!.id!,
      encounter: null,
      practitioner: null,
      fhirUser: null,
      fhirVersion: 'R4',
      scopes: [],
      intent: null,
    },
  })
  vi.mocked(ehrRead).mockResolvedValue({ launched: true, data: patients[0]! })
  vi.mocked(ehrSearch).mockResolvedValue({
    launched: true,
    data: { matches: encounters.slice(0, 3), included: [] },
  })
  renderHome()

  expect(await screen.findByText('Jeanne Voorbeeld')).toBeInTheDocument()
  const list = await screen.findByRole('list', { name: 'Encounters' })
  expect(list.children).toHaveLength(3)
  // The page said what it wanted; the server functions know no resource type.
  expect(ehrRead).toHaveBeenCalledWith({
    data: { type: 'Patient', id: patients[0]!.id },
  })
  expect(vi.mocked(ehrSearch).mock.calls[0]?.[0]).toMatchObject({
    data: { type: 'Encounter' },
  })
})
