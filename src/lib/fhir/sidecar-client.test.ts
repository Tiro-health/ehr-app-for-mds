// @vitest-environment node
import { startFakeSidecar } from '../../../dev/fake-sidecar.mjs'
import { FhirRequestError, NotLaunchedError, ScopeRefusedError } from './errors'
import { createFhirClient } from './sidecar-client'

type Sidecar = Awaited<ReturnType<typeof startFakeSidecar>>

const READ_ONLY = ['launch', 'patient/Patient.rs', 'patient/Encounter.rs']
const running: Sidecar[] = []

/** Starts a pretend EHR, launches the app from it, and returns the helper for that visitor. */
async function launched(
  options: { scopes?: string[]; pageSize?: number } = {},
  query = '',
) {
  const sidecar = await startFakeSidecar({
    publicPort: 0,
    apiPort: 0,
    ...options,
  })
  running.push(sidecar)
  vi.stubEnv('EHR_SIDECAR_URL', sidecar.apiUrl)
  const cookie = await sidecar.launch(query)
  return { sidecar, cookie, fhir: createFhirClient(() => cookie) }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(running.splice(0).map((sidecar) => sidecar.close()))
})

describe('context', () => {
  test('gives the patient, encounter and practitioner of the launch', async () => {
    const { fhir } = await launched()
    expect(await fhir.context()).toMatchObject({
      patient: 'synthetic-patient-1',
      encounter: 'synthetic-encounter-3',
      practitioner: 'synthetic-practitioner-1',
      fhirUser: 'Practitioner/synthetic-practitioner-1',
      fhirVersion: 'R4',
    })
  })

  test('lists the granted scopes', async () => {
    const { fhir } = await launched({ scopes: READ_ONLY })
    expect((await fhir.context()).scopes).toEqual([
      'launch',
      'openid',
      'fhirUser',
      'patient/Patient.rs',
      'patient/Encounter.rs',
    ])
  })

  test('has no practitioner when the EHR did not say who is signed in', async () => {
    const { fhir } = await launched({}, '?user=none')
    expect(await fhir.context()).toMatchObject({
      patient: 'synthetic-patient-1',
      practitioner: null,
      fhirUser: null,
    })
  })
})

describe('no session', () => {
  test('a visitor without a cookie is not launched', async () => {
    const { sidecar } = await launched()
    vi.stubEnv('EHR_SIDECAR_URL', sidecar.apiUrl)
    const fhir = createFhirClient(() => undefined)
    await expect(fhir.context()).rejects.toBeInstanceOf(NotLaunchedError)
  })

  test('a cookie the sidecar does not know is not launched', async () => {
    await launched()
    const fhir = createFhirClient(() => '__Host-smart=someone-else')
    await expect(fhir.context()).rejects.toBeInstanceOf(NotLaunchedError)
    await expect(fhir.search('Encounter')).rejects.toBeInstanceOf(
      NotLaunchedError,
    )
  })

  test('an ended session is not launched', async () => {
    const { fhir, sidecar } = await launched()
    sidecar.endSessions()
    await expect(
      fhir.read('Patient', 'synthetic-patient-1'),
    ).rejects.toBeInstanceOf(NotLaunchedError)
  })

  test('an app running without a sidecar is not launched', async () => {
    const { fhir, sidecar } = await launched()
    await sidecar.close()
    await expect(fhir.context()).rejects.toBeInstanceOf(NotLaunchedError)
  })
})

describe('refused scope', () => {
  test('names the scope that was not granted', async () => {
    const { fhir } = await launched({
      scopes: ['launch', 'patient/Patient.rs'],
    })
    const error = await fhir.search('Encounter').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScopeRefusedError)
    expect((error as ScopeRefusedError).scope).toBe('patient/Encounter.rs')
    expect((error as Error).message).toContain('smart.json')
  })

  test('names the create scope when filing a document', async () => {
    const { fhir } = await launched({ scopes: READ_ONLY })
    const error = await fhir
      .createDocumentReference({
        type: 'report',
        title: 'Note',
        contentType: 'text/plain',
        data: 'Synthetic note',
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScopeRefusedError)
    expect((error as ScopeRefusedError).scope).toBe(
      'patient/DocumentReference.c',
    )
  })
})

describe('read', () => {
  test('reads the launched patient', async () => {
    const { fhir } = await launched()
    const patient = await fhir.read('Patient', 'synthetic-patient-1')
    expect(patient.name?.[0]?.family).toBe('Voorbeeld')
  })

  test('another patient is not found', async () => {
    const { fhir } = await launched()
    const error = await fhir
      .read('Patient', 'synthetic-patient-2')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(404)
  })

  test('refuses an id that is not a FHIR id before asking the EHR', async () => {
    const { fhir } = await launched()
    expect(() => fhir.read('Patient', '?_count=999')).toThrow(TypeError)
    expect(() => fhir.read('Patient', '../session')).toThrow(TypeError)
  })
})

describe('search', () => {
  test('returns only the launched patient’s encounters', async () => {
    const { fhir } = await launched()
    const encounters = await fhir.search('Encounter')
    expect(encounters.map((e) => e.id)).toEqual([
      'synthetic-encounter-1',
      'synthetic-encounter-2',
      'synthetic-encounter-3',
    ])
  })

  test('filters with an exact-match parameter', async () => {
    const { fhir } = await launched()
    const finished = await fhir.search('Encounter', { status: 'finished' })
    expect(finished).toHaveLength(2)
    const inpatient = await fhir.search('Encounter', { class: 'IMP' })
    expect(inpatient.map((e) => e.id)).toEqual(['synthetic-encounter-2'])
  })

  test('follows the pages the EHR hands out', async () => {
    const { fhir } = await launched({ pageSize: 1 })
    expect(await fhir.search('Encounter')).toHaveLength(3)
    expect(await fhir.search('Encounter', {}, { max: 2 })).toHaveLength(2)
  })

  test('a parameter the EHR does not know is an error with status 400', async () => {
    const { fhir } = await launched()
    const error = await fhir
      // @ts-expect-error "date" is not a parameter the clinic's FHIR API accepts
      .search('Encounter', { date: '2026-03-03' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).not.toContain('2026-03-03')
  })
})

describe('create', () => {
  const WRITE = [...READ_ONLY, 'patient/DocumentReference.cruds']

  test('files a document for the launched patient', async () => {
    const { fhir } = await launched({ scopes: WRITE })
    const saved = await fhir.createDocumentReference({
      type: 'report',
      title: 'Synthetic note',
      contentType: 'text/plain',
      data: 'Nothing real.',
    })
    expect(saved.id).toBeTruthy()
    expect(saved.subject?.reference).toBe('Patient/synthetic-patient-1')
    expect(saved).not.toHaveProperty('date')
    expect(saved).not.toHaveProperty('context')
    expect(saved.content[0]?.attachment.data).toBe(
      Buffer.from('Nothing real.').toString('base64'),
    )

    const found = await fhir.search('DocumentReference', {
      patient: 'synthetic-patient-1',
    })
    expect(found.map((d) => d.id)).toEqual([saved.id])
  })

  test('refuses a document over 10 MiB before sending it', async () => {
    const { fhir } = await launched({ scopes: WRITE })
    await expect(
      fhir.createDocumentReference({
        type: 'report',
        title: 'Too large',
        contentType: 'application/octet-stream',
        data: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toBeInstanceOf(RangeError)
  })

  test('passes on the EHR’s refusal of a document with a date', async () => {
    const { fhir } = await launched({ scopes: WRITE })
    const error = await fhir
      .create({
        resourceType: 'DocumentReference',
        status: 'current',
        date: '2026-11-14T10:00:00Z',
        subject: { reference: 'Patient/synthetic-patient-1' },
        content: [{ attachment: { contentType: 'text/plain', data: 'eA==' } }],
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(422)
    expect((error as FhirRequestError).outcome?.resourceType).toBe(
      'OperationOutcome',
    )
  })
})

test('only ever talks to this machine', async () => {
  const { cookie } = await launched()
  vi.stubEnv('EHR_SIDECAR_URL', 'https://example.org')
  const fhir = createFhirClient(() => cookie)
  await expect(fhir.context()).rejects.toThrow('loopback')
})

describe('the pretend sidecar behaves as the real one', () => {
  test('a clinic that grants a subset still launches', async () => {
    const { fhir } = await launched({ scopes: ['patient/Patient.rs'] })
    expect((await fhir.context()).scopes).toEqual([
      'launch',
      'openid',
      'fhirUser',
      'patient/Patient.rs',
    ])
  })

  test('a clinic that grants none of the asked scopes refuses the launch', async () => {
    const sidecar = await startFakeSidecar({
      publicPort: 0,
      apiPort: 0,
      scopes: ['patient/Observation.rs'],
    })
    running.push(sidecar)
    const answer = await fetch(`${sidecar.publicUrl}/launch`, {
      redirect: 'manual',
    })
    expect(answer.headers.get('location')).toBe(
      '/not-launched?reason=scope-missing',
    )
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  test('only GET and HEAD reach /launch and /callback', async () => {
    const { sidecar } = await launched()
    for (const path of ['/launch', '/callback']) {
      const answer = await fetch(sidecar.publicUrl + path, { method: 'POST' })
      expect(answer.status).toBe(405)
    }
  })

  test('a path that could leave the clinic’s FHIR base is refused', async () => {
    const { sidecar, cookie } = await launched()
    const answer = await fetch(`${sidecar.apiUrl}/fhir/Patient/a%20b`, {
      headers: { cookie },
    })
    expect(answer.status).toBe(400)
    expect(await answer.json()).toEqual({ error: 'invalid_path' })
  })

  test('search links come back through the loopback API', async () => {
    const { sidecar, cookie } = await launched({ pageSize: 1 })
    const answer = await fetch(`${sidecar.apiUrl}/fhir/Encounter`, {
      headers: { cookie },
    })
    const bundle = (await answer.json()) as { link: { url: string }[] }
    for (const { url } of bundle.link) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/fhir[/?]/)
    }
  })
})
