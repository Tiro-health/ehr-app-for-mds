import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { appConfig } from '@/app.config'
import { SmartProvider } from '@/hooks/use-smart'
import { fakeEhr, launchInFakeEhr, testSettings } from '@/lib/smart/fake-ehr'
import { HomePage } from './home'

async function openedFromEhr(options: Parameters<typeof fakeEhr>[1] = {}) {
  const settings = await testSettings()
  const ehr = fakeEhr(settings, options)
  ehr.add(
    {
      resourceType: 'Patient',
      id: 'p1',
      name: [{ family: 'Reyskens', given: ['Joachim'] }],
      gender: 'male',
      birthDate: '1980-04-06',
    },
    ...['2019', '2020', '2021', '2022', '2023', '2024', '2025'].map(
      (year, i) =>
        ({
          resourceType: 'Encounter',
          id: `e${i}`,
          status: 'finished',
          class: { code: 'AMB' },
          subject: { reference: 'Patient/p1' },
          period: { start: `${year}-03-17` },
          reasonCode: [{ text: `Check-up ${year}` }],
        }) as const,
    ),
  )
  const { connect } = await launchInFakeEhr(ehr, settings, 'p1')
  render(
    <SmartProvider connect={connect} fetch={ehr.fetch}>
      <HomePage />
    </SmartProvider>,
  )
  return ehr
}

beforeEach(() => window.localStorage.clear())

test('opened directly, it says it was not opened from a patient’s chart', async () => {
  render(
    <SmartProvider connect={async () => ({ status: 'not-launched' })}>
      <HomePage />
    </SmartProvider>,
  )
  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
  expect(
    await screen.findByText('Not opened from a patient’s chart'),
  ).toBeInTheDocument()
  expect(screen.queryByText('Encounters')).not.toBeInTheDocument()
})

test('a failed launch shows the reason', async () => {
  render(
    <SmartProvider
      connect={async () => ({
        status: 'not-launched',
        error: 'No second factor.',
      })}
    >
      <HomePage />
    </SmartProvider>,
  )
  expect(await screen.findByText('No second factor.')).toBeInTheDocument()
})

test('shows the launched patient and their most recent encounters', async () => {
  await openedFromEhr()
  expect(await screen.findByTestId('patient-name')).toHaveTextContent(
    'Joachim Reyskens',
  )
  expect(screen.getByTestId('patient-details')).toHaveTextContent(
    /Born 6 Apr 1980 \(\d+ years\) · Male/,
  )
  const list = await screen.findByRole('list', { name: 'Encounters' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows).toHaveLength(5)
  expect(rows[0]).toHaveTextContent('17 Mar 2025')
  expect(rows[0]).toHaveTextContent('Check-up 2025')
  expect(rows[0]).toHaveTextContent('Outpatient')
  expect(
    screen.getByText('7 in the EHR, most recent first'),
  ).toBeInTheDocument()
})

test('how many encounters to show is saved on the device when the EHR has no App State', async () => {
  await openedFromEhr()
  const list = await screen.findByRole('list', { name: 'Encounters' })
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  await waitFor(() =>
    expect(screen.getByTestId('setting-saved')).toHaveTextContent(
      'Saved on this device',
    ),
  )
  expect(window.localStorage.getItem('app-state:encounters-shown')).toBe('0')
})

test('with App State in the EHR, the setting is saved there for the clinician', async () => {
  const ehr = await openedFromEhr({ openid: true, appState: true })
  await screen.findByRole('list', { name: 'Encounters' })
  fireEvent.click(screen.getByRole('button', { name: '10' }))
  await waitFor(() =>
    expect(screen.getByTestId('setting-saved')).toHaveTextContent(
      'Saved in the EHR for you',
    ),
  )
  const saved = [...ehr.resources.values()].find(
    (r) => r.resourceType === 'Basic',
  )
  expect(saved).toMatchObject({
    subject: {
      reference: 'https://ehr.example.org/t/clinic/fhir/R4/Practitioner/123',
    },
    code: { coding: [{ code: 'encounters-shown' }] },
    extension: [{ valueString: '10' }],
  })
  expect(window.localStorage.getItem('app-state:encounters-shown')).toBeNull()
})
