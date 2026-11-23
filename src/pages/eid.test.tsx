import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Patient } from 'fhir/r4'
import { eidVerify } from '@/lib/eid.functions'
import { simulatedSource } from '@/lib/eid/card-source'
import type { CardSource } from '@/lib/eid/card-source'
import { parseCard } from '@/lib/eid/tlv'
import type { EidReading } from '@/lib/eid/types'
import { ehrContext, ehrRead } from '@/lib/ehr.functions'
import matching from '../../fixtures/eid/card-matching-patient-1.json'
import specimen from '../../fixtures/eid/card-beidconnect-specimen.json'
import patient from '../../fixtures/r4/Patient-patient-1.json'
import { EidPage } from './eid'

vi.mock('@/lib/ehr.functions', () => ({
  ehrContext: vi.fn(),
  ehrRead: vi.fn(),
  ehrSearch: vi.fn(),
  ehrCreate: vi.fn(),
  ehrUpdate: vi.fn(),
  ehrDelete: vi.fn(),
}))
vi.mock('@/lib/eid.functions', () => ({ eidVerify: vi.fn() }))

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

/** What the server function answers for a card: the real parser, the signature result given. */
function readingOf(
  answer: typeof specimen,
  signatures: Partial<EidReading['signatures']> = {},
): EidReading {
  const card = answer.Readers[0]
  return {
    card: parseCard(bytes(card.id), bytes(card.addr)),
    signatures: {
      identity: true,
      address: true,
      algorithm: 'RSA SHA-256',
      signer: 'eID TEST RRN',
      signerValidToday: true,
      chainChecked: false,
      ...signatures,
    },
    validToday: true,
  }
}

function launched() {
  vi.mocked(ehrContext).mockResolvedValue({
    launched: true,
    data: {
      patient: 'patient-1',
      encounter: null,
      practitioner: null,
      fhirUser: null,
      fhirVersion: 'R4',
      scopes: ['patient/Patient.rs'],
      intent: null,
    },
  })
  vi.mocked(ehrRead).mockResolvedValue({
    launched: true,
    data: patient as Patient,
  })
}

function renderPage(sources: CardSource[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <EidPage sources={sources} />
    </QueryClientProvider>,
  )
}

const reader = (answer: unknown): CardSource => ({
  ...simulatedSource('reader', 'Card reader', answer),
  simulated: false,
})

async function readCard() {
  await screen.findByText('Jeanne Voorbeeld')
  fireEvent.click(screen.getByRole('button', { name: 'Read eID' }))
}

beforeEach(() => {
  vi.mocked(eidVerify).mockReset()
  launched()
})

test('shows the heading and the patient', async () => {
  renderPage([reader(matching)])
  expect(
    screen.getByRole('heading', { name: 'Check eID card' }),
  ).toBeInTheDocument()
  expect(await screen.findByText('Jeanne Voorbeeld')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Read eID' })).toBeEnabled()
})

test('a card of the same person matches on every field', async () => {
  vi.mocked(eidVerify).mockResolvedValue({
    launched: true,
    data: readingOf(matching),
  })
  renderPage([reader(matching)])
  await readCard()

  const table = await screen.findByRole('table', { name: 'Comparison' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(5)
  for (const row of rows) expect(row).toHaveAttribute('data-outcome', 'match')
  expect(within(rows[0]).getAllByText('58.04.12-002.12')).toHaveLength(2)
  expect(
    screen.getByText('5 of 5 fields match, none differ.'),
  ).toBeInTheDocument()

  // The page sent the server exactly the five files of the card, and nothing else.
  const card = matching.Readers[0]
  expect(eidVerify).toHaveBeenCalledWith({
    data: {
      id: card.id,
      addr: card.addr,
      idsig: card.idsig,
      addrsig: card.addrsig,
      rrncert: card.rrncert,
    },
  })
})

test('valid signatures are not presented as proof that the card is genuine', async () => {
  vi.mocked(eidVerify).mockResolvedValue({
    launched: true,
    data: readingOf(matching),
  })
  renderPage([reader(matching)])
  await readCard()

  expect(
    await screen.findByText('Signatures valid, origin of the card not checked'),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/does not prove the card is genuine/),
  ).toBeInTheDocument()
  expect(screen.queryByText('Simulated card')).not.toBeInTheDocument()
})

test("someone else's card shows what differs", async () => {
  vi.mocked(eidVerify).mockResolvedValue({
    launched: true,
    data: readingOf(specimen),
  })
  renderPage([reader(specimen)])
  await readCard()

  const table = await screen.findByRole('table', { name: 'Comparison' })
  const row = within(table).getByRole('row', { name: /Family name/ })
  expect(row).toHaveAttribute('data-outcome', 'mismatch')
  expect(within(row).getByText('Specimen eID 18-75')).toBeInTheDocument()
  expect(within(row).getByText('Voorbeeld')).toBeInTheDocument()
  expect(screen.getByText('4 of 5 fields differ.')).toBeInTheDocument()
  expect(screen.getByText('Specimenstraat 12, 0000 Utopia')).toBeInTheDocument()
})

test('an invalid signature is a warning not to rely on the card', async () => {
  vi.mocked(eidVerify).mockResolvedValue({
    launched: true,
    data: readingOf(matching, {
      identity: false,
      address: false,
      algorithm: null,
    }),
  })
  renderPage([reader(matching)])
  await readCard()

  expect(await screen.findByText('Signatures not valid')).toBeInTheDocument()
  expect(
    screen.getByText(/Do not rely on what this card says/),
  ).toBeInTheDocument()
})

test('a simulated card is labelled as one', async () => {
  vi.mocked(eidVerify).mockResolvedValue({
    launched: true,
    data: readingOf(matching),
  })
  renderPage([simulatedSource('sim', 'Simulated card: test', matching)])
  await screen.findByText('Jeanne Voorbeeld')
  fireEvent.click(screen.getByRole('button', { name: 'Simulated card: test' }))

  expect(await screen.findByText('Simulated card')).toBeInTheDocument()
})

test.each([
  [undefined, 'BeIDConnect is not installed in this browser'],
  [
    { result: 'timeout' },
    'The BeIDConnect program is not installed on this computer',
  ],
  [{ result: 'no_reader' }, 'No card reader found'],
  [{ result: 'no_card', Readers: [] }, 'No eID card in the reader'],
  [
    { result: 'no_card', report: 'card_type_unsupported' },
    'This card is not an eID card',
  ],
  [{ result: 'busy' }, 'The card reader is busy'],
  [{ result: 'general_error' }, 'The card could not be read'],
])('BeIDConnect answering %j shows "%s"', async (answer, title) => {
  const source: CardSource =
    answer === undefined
      ? {
          id: 'reader',
          label: 'Card reader',
          simulated: false,
          read: async () => ({ status: 'extension-missing' }),
        }
      : reader(answer)
  renderPage([source])
  await readCard()

  expect(await screen.findByText(title)).toBeInTheDocument()
  expect(eidVerify).not.toHaveBeenCalled()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('a session that ended while the page was open says so', async () => {
  vi.mocked(eidVerify).mockResolvedValue({ launched: false })
  renderPage([reader(matching)])
  await readCard()

  expect(await screen.findByText('Your session has ended')).toBeInTheDocument()
})

test('a card the server cannot read gives an error without card data', async () => {
  vi.mocked(eidVerify).mockRejectedValue(new Error('boom'))
  renderPage([reader(matching)])
  await readCard()

  expect(
    await screen.findByText('The card could not be checked'),
  ).toBeInTheDocument()
  expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
})
