import { QueryClient } from '@tanstack/react-query'
import { isRedirect } from '@tanstack/react-router'
import { requireEhr, unmetNeed } from '@/hooks/ehr'
import { ehrContext } from '@/lib/ehr.functions'
import type { LaunchContext } from '@/lib/fhir/sidecar-client'

vi.mock('@/lib/ehr.functions', () => ({
  ehrContext: vi.fn(),
  ehrRead: vi.fn(),
  ehrSearch: vi.fn(),
  ehrCreate: vi.fn(),
  ehrUpdate: vi.fn(),
  ehrDelete: vi.fn(),
}))

const session = (data: Partial<LaunchContext> = {}) => ({
  launched: true as const,
  data: {
    patient: 'patient-1',
    encounter: null,
    practitioner: 'practitioner-1',
    fhirUser: 'Practitioner/practitioner-1',
    fhirVersion: '4.0.1',
    scopes: ['patient/Patient.rs', 'patient/Encounter.rs'],
    intent: null,
    ...data,
  },
})

describe('unmetNeed', () => {
  test('without a session, every need is unmet', () => {
    expect(unmetNeed({ launched: false })).toBe('not-from-ehr')
  })

  test('a session meets the default need', () => {
    expect(unmetNeed(session({ patient: null }))).toBeNull()
  })

  test('a patient need fails without a patient', () => {
    expect(unmetNeed(session({ patient: null }), { patient: true })).toBe(
      'no-patient',
    )
  })

  test('a patient/ scope implies a patient', () => {
    const needs = { scopes: ['patient/Encounter.rs'] }
    expect(unmetNeed(session({ patient: null }), needs)).toBe('no-patient')
    expect(unmetNeed(session(), needs)).toBeNull()
  })

  test('every letter of a needed scope must be granted', () => {
    const granted = session({ scopes: ['patient/Encounter.r'] })
    expect(unmetNeed(granted, { scopes: ['patient/Encounter.rs'] })).toBe(
      'scope-missing',
    )
    expect(unmetNeed(granted, { scopes: ['patient/Encounter.r'] })).toBeNull()
  })

  test('a filtered grant does not meet an unfiltered need', () => {
    const granted = session({
      scopes: ['user/Basic.rs?code=urn:tiro-health:basic-kind|api-key'],
    })
    expect(unmetNeed(granted, { scopes: ['user/Basic.rs'] })).toBe(
      'scope-missing',
    )
  })
})

describe('requireEhr', () => {
  test('asks for the session itself and redirects without one', async () => {
    vi.mocked(ehrContext).mockResolvedValue({ launched: false })
    const thrown = await requireEhr(new QueryClient()).catch((e: unknown) => e)
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: unknown }).options).toMatchObject({
      to: '/not-launched',
      search: { reason: 'not-from-ehr' },
    })
  })

  test('lets a visitor through when the needs are met', async () => {
    vi.mocked(ehrContext).mockResolvedValue(session())
    await expect(
      requireEhr(new QueryClient(), { scopes: ['patient/Encounter.rs'] }),
    ).resolves.toBeUndefined()
  })
})
