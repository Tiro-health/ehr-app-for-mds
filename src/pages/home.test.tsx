import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { getEncounters, getPatient } from '@/lib/ehr.functions'
import { encounters, patients } from '../../dev/synthetic-data.mjs'
import { HomePage } from './home'

vi.mock('@/lib/ehr.functions', () => ({
  getPatient: vi.fn(),
  getEncounters: vi.fn(),
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
  vi.mocked(getPatient).mockResolvedValue({ launched: false })
  vi.mocked(getEncounters).mockResolvedValue({ launched: false })
  renderHome()

  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  expect(screen.queryByText('Opened from the EHR')).not.toBeInTheDocument()
})

test('shows the patient and encounters when opened from the EHR', async () => {
  vi.mocked(getPatient).mockResolvedValue({
    launched: true,
    data: patients[0],
  })
  vi.mocked(getEncounters).mockResolvedValue({
    launched: true,
    data: encounters.slice(0, 3),
  })
  renderHome()

  expect(await screen.findByText('Jeanne Voorbeeld')).toBeInTheDocument()
  const list = await screen.findByRole('list', { name: 'Encounters' })
  expect(list.children).toHaveLength(3)
})
