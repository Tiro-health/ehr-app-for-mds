// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Basic, Bundle, FhirResource } from 'fhir/r4'
import { startFakeSidecar } from '../../../dev/fake-sidecar.mjs'
import { createDocumentReference } from './documents'
import { FhirRequestError, NotLaunchedError, ScopeRefusedError } from './errors'
import { createFhirClient } from './sidecar-client'

type Sidecar = Awaited<ReturnType<typeof startFakeSidecar>>

const READ_ONLY = ['launch', 'patient/Patient.rs', 'patient/Encounter.rs']
const running: Sidecar[] = []

/** Starts a pretend EHR, launches the app from it, and returns the helper for that visitor. */
async function launched(
  options: { scopes?: string[]; pageSize?: number; asked?: string[] } = {},
  query = '',
) {
  const { asked, ...sidecarOptions } = options
  const sidecar = await startFakeSidecar({
    publicPort: 0,
    apiPort: 0,
    ...sidecarOptions,
  })
  running.push(sidecar)
  vi.stubEnv('EHR_SIDECAR_URL', sidecar.apiUrl)
  const cookie = await sidecar.launch(query)
  return {
    sidecar,
    cookie,
    fhir: createFhirClient(() => cookie, { asked }),
  }
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
    const error = await createDocumentReference(fhir, {
      type: 'report',
      title: 'Note',
      contentType: 'text/plain',
      data: 'Synthetic note',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScopeRefusedError)
    expect((error as ScopeRefusedError).scope).toBe(
      'patient/DocumentReference.c',
    )
  })
})

describe('refused scope, beyond reading', () => {
  test('names the update and the delete scope', async () => {
    const { fhir } = await launched({ scopes: READ_ONLY })
    const [encounter] = await fhir.search('Encounter')
    const updating = await fhir.update(encounter!).catch((e: unknown) => e)
    expect((updating as ScopeRefusedError).scope).toBe('patient/Encounter.u')
    const deleting = await fhir.delete(encounter!).catch((e: unknown) => e)
    expect((deleting as ScopeRefusedError).scope).toBe('patient/Encounter.d')
  })

  test('names a user-level scope in the words of smart.json', async () => {
    const { fhir } = await launched({
      scopes: READ_ONLY,
      asked: [...READ_ONLY, 'user/Basic.cruds'],
    })
    const error = await fhir.search('Basic').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScopeRefusedError)
    expect((error as ScopeRefusedError).scope).toBe('user/Basic.cruds')
    expect((error as ScopeRefusedError).listed).toBe(true)
    expect((error as Error).message).toContain('smart.json already lists it')
  })

  test('suggests the level the app already uses for that type', async () => {
    const { fhir } = await launched({
      scopes: [...READ_ONLY, 'user/Basic.rs'],
    })
    const error = await fhir
      .create<Basic>({ resourceType: 'Basic', code: { text: 'state' } })
      .catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe('user/Basic.c')
    expect((error as ScopeRefusedError).listed).toBe(false)
  })

  test('names the scope for a plain path given to request()', async () => {
    const { fhir } = await launched({ scopes: ['patient/Patient.rs'] })
    const error = await fhir
      .request('GET', 'Encounter?status=finished')
      .catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe('patient/Encounter.rs')
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

  test('a parameter the EHR refuses is an error that names the parameters sent', async () => {
    const { fhir } = await launched()
    const error = await fhir
      .search('Encounter', { status: 'finished', location: 'ward-3' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).toContain('status, location')
    expect((error as Error).message).toContain('metadata')
    expect((error as Error).message).not.toContain('ward-3')
    expect((error as FhirRequestError).outcome?.issue[0]?.diagnostics).toBe(
      'unsupported search parameter',
    )
  })

  test('accepts any parameter the EHR knows, and repeats a list', async () => {
    const { fhir, sidecar, cookie } = await launched()
    expect(
      await fhir.search('Encounter', { date: 'ge2026-06-01' }),
    ).toHaveLength(2)
    // A repeated parameter means "all of these": no encounter has both.
    expect(
      await fhir.search('Encounter', { status: ['finished', 'in-progress'] }),
    ).toEqual([])
    expect(
      await fhir.search('Encounter', { status: 'finished', class: undefined }),
    ).toHaveLength(2)
    const answer = await fetch(
      `${sidecar.apiUrl}/fhir/Encounter?status=finished&status=in-progress`,
      { headers: { cookie } },
    )
    expect(((await answer.json()) as Bundle).total).toBe(0)
  })

  test('a type the EHR does not serve is an error that says so', async () => {
    const { fhir } = await launched()
    const searching = await fhir.search('Observation').catch((e: unknown) => e)
    expect(searching).toBeInstanceOf(FhirRequestError)
    expect((searching as FhirRequestError).status).toBe(404)
    expect((searching as Error).message).toContain(
      'The EHR does not serve Observation.',
    )
    const reading = await fhir.read('Observation', 'x').catch((e: unknown) => e)
    expect((reading as FhirRequestError).status).toBe(404)
  })
})

describe('searchWithIncluded', () => {
  // The Tiro EHR includes nothing today, so this plays an EHR that does.
  async function ehrThatIncludes() {
    const pages: Bundle<FhirResource>[] = [
      {
        resourceType: 'Bundle',
        type: 'searchset',
        link: [
          { relation: 'next', url: 'http://elsewhere.example/fhir?page=2' },
        ],
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              id: 'e1',
              status: 'finished',
              class: {},
            },
            search: { mode: 'match' },
          },
          {
            resource: { resourceType: 'Practitioner', id: 'p1' },
            search: { mode: 'include' },
          },
        ],
      },
      {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              id: 'e2',
              status: 'finished',
              class: {},
            },
            search: { mode: 'match' },
          },
          {
            resource: {
              resourceType: 'Encounter',
              id: 'e0',
              status: 'finished',
              class: {},
            },
            search: { mode: 'include' },
          },
          {
            resource: { resourceType: 'Practitioner', id: 'p1' },
            search: { mode: 'include' },
          },
          {
            resource: { resourceType: 'OperationOutcome', issue: [] },
            search: { mode: 'outcome' },
          },
        ],
      },
    ]
    const asked: string[] = []
    const server = http.createServer((req, res) => {
      asked.push(req.url ?? '')
      res.setHeader('content-type', 'application/fhir+json')
      res.end(JSON.stringify(pages[req.url?.includes('page=2') ? 1 : 0]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    vi.stubEnv('EHR_SIDECAR_URL', `http://127.0.0.1:${port}`)
    return { asked, close: () => new Promise((done) => server.close(done)) }
  }

  test('separates the matches from what came along, over all pages', async () => {
    const ehr = await ehrThatIncludes()
    const fhir = createFhirClient(() => '__Host-smart=x')
    const params = { _include: ['Encounter:participant', 'Encounter:part-of'] }
    const { matches, included } = await fhir.searchWithIncluded(
      'Encounter',
      params,
    )
    expect(matches.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(included.map((r) => `${r.resourceType}/${r.id}`)).toEqual([
      'Practitioner/p1',
      'Encounter/e0',
    ])
    expect(ehr.asked).toEqual([
      '/fhir/Encounter?_include=Encounter%3Aparticipant&_include=Encounter%3Apart-of',
      '/fhir?page=2',
    ])
    // search() gives the same matches and leaves the rest out.
    expect((await fhir.search('Encounter', params)).map((e) => e.id)).toEqual([
      'e1',
      'e2',
    ])
    await ehr.close()
  })
})

describe('update and delete', () => {
  const EDIT = ['patient/Patient.rs', 'patient/Encounter.cruds']
  const STATE = ['patient/Patient.rs', 'user/Basic.cruds']

  test('updates a resource that was read, and refuses a stale copy', async () => {
    const { fhir } = await launched({ scopes: EDIT })
    const read = await fhir.read('Encounter', 'synthetic-encounter-3')
    const saved = await fhir.update({ ...read, status: 'finished' })
    expect(saved.status).toBe('finished')
    expect(saved.meta?.versionId).toBe('2')
    expect((await fhir.read('Encounter', read.id!)).status).toBe('finished')

    const stale = await fhir.update(read).catch((e: unknown) => e)
    expect((stale as FhirRequestError).status).toBe(412)
    expect((stale as Error).message).toContain('read it again')
  })

  test('an update without the version it is based on is refused by the EHR', async () => {
    const { fhir } = await launched({ scopes: EDIT })
    const read = await fhir.read('Encounter', 'synthetic-encounter-3')
    const error = await fhir
      .update({ ...read, meta: undefined })
      .catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(428)
    expect((error as Error).message).toContain('meta.versionId')
    expect(() => fhir.update({ resourceType: 'Encounter' } as never)).toThrow(
      TypeError,
    )
  })

  test('an interaction the EHR does not have for a type says so', async () => {
    const { fhir } = await launched({ scopes: READ_ONLY })
    const patient = await fhir.read('Patient', 'synthetic-patient-1')
    const error = await fhir.update(patient).catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).toContain(
      'does not support this interaction for Patient',
    )
  })

  test('deletes by resource or by type and id', async () => {
    const { fhir } = await launched({ scopes: EDIT })
    const [first, second] = await fhir.search('Encounter')
    await fhir.delete(first!)
    await fhir.delete('Encounter', second!.id!)
    expect((await fhir.search('Encounter')).map((e) => e.id)).toEqual([
      'synthetic-encounter-3',
    ])
    const gone = await fhir
      .read('Encounter', first!.id!)
      .catch((e: unknown) => e)
    expect((gone as FhirRequestError).status).toBe(404)
  })

  test('creates, updates and deletes a user-level resource', async () => {
    const { fhir } = await launched({ scopes: STATE })
    const made = await fhir.create<Basic>({
      resourceType: 'Basic',
      code: { coding: [{ system: 'urn:example:state', code: 'settings' }] },
    })
    expect(made.id).toBeTruthy()
    expect(await fhir.search('Basic', { code: 'settings' })).toHaveLength(1)
    const changed = await fhir.update({ ...made, code: { text: 'changed' } })
    expect(changed.meta?.versionId).toBe('2')

    // This EHR wants the version on a delete of this type.
    const blind = await fhir.delete('Basic', made.id!).catch((e: unknown) => e)
    expect((blind as FhirRequestError).status).toBe(428)
    await fhir.delete('Basic', made.id!, { version: '2' })
    expect(await fhir.search('Basic')).toEqual([])
  })
})

describe('request', () => {
  test('reaches anything under the FHIR base', async () => {
    const { fhir } = await launched()
    const statement = await fhir.request<{ resourceType: string }>(
      'GET',
      'metadata',
    )
    expect(statement.resourceType).toBe('CapabilityStatement')
    const bundle = await fhir.request<Bundle>(
      'GET',
      '/Encounter?status=finished',
    )
    expect(bundle.total).toBe(2)
  })

  test('an operation the EHR does not have is an error without the path', async () => {
    const { fhir } = await launched()
    const error = await fhir
      .request('GET', 'Patient/synthetic-patient-1/$everything')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).not.toContain('synthetic-patient-1')
  })

  test('sends the version of a write', async () => {
    const { fhir } = await launched({
      scopes: ['patient/Patient.rs', 'patient/Encounter.cruds'],
    })
    const read = await fhir.read('Encounter', 'synthetic-encounter-3')
    const saved = await fhir.request<typeof read>(
      'PUT',
      `Encounter/${read.id}`,
      { ...read, status: 'finished' },
      { version: read.meta?.versionId },
    )
    expect(saved.meta?.versionId).toBe('2')
  })

  test('cannot leave the FHIR base or this machine', async () => {
    const { fhir } = await launched()
    for (const path of [
      'http://example.org/fhir/Patient',
      '//example.org/Patient',
      '../session',
      'Patient/../../session',
      'Patient/a b',
      'Patient/%2e%2e/session',
      'Patient\\x',
      'Patient#x',
      '@example.org/Patient',
    ]) {
      expect(() => fhir.request('GET', path), path).toThrow(TypeError)
    }
    // Not under /fhir: the launch context is not reachable this way.
    const session = await fhir
      .request('GET', 'session')
      .catch((e: unknown) => e)
    expect((session as FhirRequestError).status).toBe(404)
  })
})

describe('create', () => {
  const WRITE = [...READ_ONLY, 'patient/DocumentReference.cruds']

  test('files a document for the launched patient', async () => {
    const { fhir } = await launched({ scopes: WRITE })
    const saved = await createDocumentReference(fhir, {
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
      createDocumentReference(fhir, {
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
