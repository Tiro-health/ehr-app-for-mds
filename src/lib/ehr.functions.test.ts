import type { Basic, Patient } from 'fhir/r4'
import key from '../../fixtures/r4/Basic-api-key-gemini.json'
import patient from '../../fixtures/r4/Patient-patient-1.json'
import { ehrRead, ehrSearch } from './ehr.functions'
import { fhir } from './fhir.server'

// The server functions answer the browser. The key the EHR shares with the app must never be
// in an answer, whatever the page asks for.

vi.mock('@tanstack/react-start', () => {
  const builder = (validate: (input: unknown) => unknown = (x) => x) => ({
    inputValidator: (next: (input: unknown) => unknown) => builder(next),
    handler:
      (run: (ctx: { data: unknown }) => unknown) => (call: { data: unknown }) =>
        run({ data: validate(call.data) }),
  })
  return { createServerFn: () => builder() }
})
vi.mock('./fhir.server', () => ({
  fhir: { read: vi.fn(), searchWithIncluded: vi.fn() },
}))

test('a search never returns the key', async () => {
  vi.mocked(fhir.searchWithIncluded).mockResolvedValue({
    matches: [key as Basic],
    included: [key as Basic, patient as Patient],
  })
  const answer = await ehrSearch({
    data: {
      type: 'Basic',
      params: { code: 'urn:tiro-health:basic-kind|api-key' },
    },
  })
  expect(answer).toEqual({
    launched: true,
    data: { matches: [], included: [patient] },
  })
})

test('a read never returns the key', async () => {
  vi.mocked(fhir.read).mockResolvedValue(key as Basic)
  await expect(
    ehrRead({ data: { type: 'Basic', id: 'api-key-gemini' } }),
  ).rejects.toThrow('Not a valid request.')
})

test('a read still returns other resources', async () => {
  vi.mocked(fhir.read).mockResolvedValue(patient as Patient)
  await expect(
    ehrRead({ data: { type: 'Patient', id: 'patient-1' } }),
  ).resolves.toEqual({ launched: true, data: patient })
})
