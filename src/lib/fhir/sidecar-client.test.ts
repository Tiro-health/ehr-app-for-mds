// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Basic, Bundle, Encounter, FhirResource } from 'fhir/r4'
import { createDocumentReference } from './documents'
import { FhirRequestError, NotLaunchedError, ScopeRefusedError } from './errors'
import { createFhirClient } from './sidecar-client'

// The helper against a stand-in for the sidecar's loopback API that answers what each test
// scripts. What the real sidecar and FHIR server do is checked with `docker compose up`.

interface Seen {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}
interface Answer {
  status?: number
  body?: unknown
}

const COOKIE = '__Host-smart=visitor'
const SESSION = {
  patient: 'patient-1',
  encounter: 'encounter-1',
  practitioner: 'practitioner-1',
  fhirUser: 'http://fhir.example/fhir/r4/Practitioner/practitioner-1',
  fhirVersion: 'R4',
  scopes: ['patient/Patient.rs', 'patient/Encounter.rs'],
  intent: null,
}
const servers: http.Server[] = []

/** Starts the stand-in. `answer` gets each request; `/session` answers SESSION unless it says otherwise. */
async function sidecar(
  answer: (seen: Seen) => Answer | undefined = () => undefined,
  session: Record<string, unknown> = SESSION,
) {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      const request = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      }
      seen.push(request)
      const scripted =
        answer(request) ??
        (request.url === '/session'
          ? { body: session }
          : { status: 404, body: outcome('not-found') })
      res.statusCode = scripted.status ?? 200
      res.setHeader('content-type', 'application/fhir+json')
      res.end(scripted.body === undefined ? '' : JSON.stringify(scripted.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  vi.stubEnv('EHR_SIDECAR_URL', `http://127.0.0.1:${port}`)
  return { seen, port }
}

const outcome = (code: string, diagnostics?: string) => ({
  resourceType: 'OperationOutcome',
  issue: [{ severity: 'error', code, diagnostics }],
})

const searchset = (
  resources: FhirResource[],
  next?: string,
): Bundle<FhirResource> => ({
  resourceType: 'Bundle',
  type: 'searchset',
  link: next ? [{ relation: 'next', url: next }] : [],
  entry: resources.map((resource) => ({
    resource,
    search: { mode: 'match' },
  })),
})

const encounter = (id: string, versionId = '1'): Encounter => ({
  resourceType: 'Encounter',
  id,
  meta: { versionId },
  status: 'finished',
  class: { code: 'AMB' },
})

const forbidden = (seen: Seen) =>
  seen.url.startsWith('/fhir')
    ? { status: 403, body: outcome('forbidden') }
    : undefined

const client = (asked?: string[]) => createFhirClient(() => COOKIE, { asked })

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    servers.splice(0).map((s) => new Promise((done) => s.close(done))),
  )
})

describe('context', () => {
  test('gives the ids of the launch, and the granted scopes', async () => {
    await sidecar()
    expect(await client().context()).toEqual({
      ...SESSION,
      practitioner: 'practitioner-1',
    })
  })

  test('takes the id from a reference, and null for what is absent', async () => {
    await sidecar(undefined, {
      patient: 'Patient/patient-1',
      encounter: null,
      practitioner: null,
      fhirUser: null,
      fhirVersion: 'R4',
      scopes: [],
      intent: null,
    })
    expect(await client().context()).toMatchObject({
      patient: 'patient-1',
      encounter: null,
      practitioner: null,
      fhirUser: null,
    })
  })

  test('passes the browser’s cookie on as is, and asks without one too', async () => {
    const { seen } = await sidecar()
    await client().context()
    await createFhirClient(() => undefined).context()
    expect(seen.map((s) => s.headers.cookie)).toEqual([COOKIE, undefined])
  })
})

describe('no session', () => {
  test('a 401 from the sidecar is not launched', async () => {
    await sidecar(() => ({ status: 401, body: { error: 'no_session' } }))
    const fhir = client()
    await expect(fhir.context()).rejects.toBeInstanceOf(NotLaunchedError)
    await expect(fhir.search('Encounter')).rejects.toBeInstanceOf(
      NotLaunchedError,
    )
    await expect(fhir.read('Patient', 'patient-1')).rejects.toBeInstanceOf(
      NotLaunchedError,
    )
  })

  test('an app running without a sidecar is not launched', async () => {
    const { port } = await sidecar()
    await new Promise((done) => servers.pop()!.close(done))
    vi.stubEnv('EHR_SIDECAR_URL', `http://127.0.0.1:${port}`)
    await expect(client().context()).rejects.toBeInstanceOf(NotLaunchedError)
  })
})

describe('refused scope', () => {
  test('names the scope that was not granted', async () => {
    await sidecar(forbidden, { ...SESSION, scopes: ['patient/Patient.rs'] })
    const error = await client()
      .search('Encounter')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScopeRefusedError)
    expect((error as ScopeRefusedError).scope).toBe('patient/Encounter.rs')
    expect((error as Error).message).toContain('smart.json')
  })

  test('names the create scope when filing a document', async () => {
    await sidecar(forbidden)
    const error = await createDocumentReference(client(), {
      type: 'report',
      title: 'Note',
      contentType: 'text/plain',
      data: 'Synthetic note',
    }).catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe(
      'patient/DocumentReference.c',
    )
  })

  test('names the update and the delete scope', async () => {
    await sidecar(forbidden)
    const fhir = client()
    const updating = await fhir
      .update(encounter('encounter-1'))
      .catch((e: unknown) => e)
    expect((updating as ScopeRefusedError).scope).toBe('patient/Encounter.u')
    const deleting = await fhir
      .delete(encounter('encounter-1'))
      .catch((e: unknown) => e)
    expect((deleting as ScopeRefusedError).scope).toBe('patient/Encounter.d')
  })

  test('names a user-level scope in the words of smart.json', async () => {
    await sidecar(forbidden)
    const error = await client(['launch', 'user/Basic.cruds'])
      .search('Basic')
      .catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe('user/Basic.cruds')
    expect((error as ScopeRefusedError).listed).toBe(true)
    expect((error as Error).message).toContain('smart.json already lists it')
  })

  test('suggests the level the app already uses for that type', async () => {
    await sidecar(forbidden, {
      ...SESSION,
      scopes: [...SESSION.scopes, 'user/Basic.rs'],
    })
    const error = await client()
      .create<Basic>({ resourceType: 'Basic', code: { text: 'state' } })
      .catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe('user/Basic.c')
    expect((error as ScopeRefusedError).listed).toBe(false)
  })

  test('names the scope for a plain path given to request()', async () => {
    await sidecar(forbidden, { ...SESSION, scopes: ['patient/Patient.rs'] })
    const error = await client()
      .request('GET', 'Encounter?status=finished')
      .catch((e: unknown) => e)
    expect((error as ScopeRefusedError).scope).toBe('patient/Encounter.rs')
  })

  test('a 403 for a scope that was granted is a plain refusal', async () => {
    await sidecar(forbidden)
    const error = await client()
      .read('Patient', 'patient-2')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FhirRequestError)
    expect((error as FhirRequestError).status).toBe(403)
  })
})

describe('read', () => {
  test('reads one resource by its id', async () => {
    const { seen } = await sidecar((s) =>
      s.url === '/fhir/Patient/patient-1'
        ? { body: { resourceType: 'Patient', id: 'patient-1' } }
        : undefined,
    )
    expect((await client().read('Patient', 'patient-1')).id).toBe('patient-1')
    expect(seen[0]?.headers.accept).toBe('application/fhir+json')
  })

  test('not found is an error with the status', async () => {
    await sidecar()
    const error = await client()
      .read('Patient', 'patient-9')
      .catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(404)
    expect((error as Error).message).not.toContain('patient-9')
  })

  test('refuses an id that is not a FHIR id before asking the EHR', async () => {
    await sidecar()
    expect(() => client().read('Patient', '?_count=999')).toThrow(TypeError)
    expect(() => client().read('Patient', '../session')).toThrow(TypeError)
  })
})

describe('search', () => {
  test('sends the parameters, repeating a list and leaving out what is undefined', async () => {
    const { seen } = await sidecar((s) =>
      s.url.startsWith('/fhir/Encounter') ? { body: searchset([]) } : undefined,
    )
    await client().search('Encounter', {
      status: ['finished', 'in-progress'],
      class: undefined,
      date: 'ge2026-06-01',
    })
    expect(seen[0]?.url).toBe(
      '/fhir/Encounter?status=finished&status=in-progress&date=ge2026-06-01',
    )
  })

  test('follows the pages through the sidecar, up to max', async () => {
    const { seen } = await sidecar((s) => {
      if (s.url === '/fhir/Encounter')
        return {
          body: searchset(
            [encounter('encounter-1')],
            'http://127.0.0.1:8081/fhir?_getpages=abc&_getpagesoffset=1',
          ),
        }
      if (s.url.startsWith('/fhir?_getpages'))
        return {
          body: searchset(
            [encounter('encounter-2')],
            'http://elsewhere.example/fhir?_getpages=abc&_getpagesoffset=2',
          ),
        }
      return undefined
    })
    const fhir = client()
    expect(
      (await fhir.search('Encounter', {}, { max: 2 })).map((e) => e.id),
    ).toEqual(['encounter-1', 'encounter-2'])
    expect(seen.map((s) => s.url)).toEqual([
      '/fhir/Encounter',
      '/fhir?_getpages=abc&_getpagesoffset=1',
    ])
  })

  test('a parameter the EHR refuses is an error that names the parameters sent', async () => {
    await sidecar(() => ({
      status: 400,
      body: outcome('invalid', 'unsupported search parameter'),
    }))
    const error = await client()
      .search('Encounter', { status: 'finished', location: 'ward-3' })
      .catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).toContain('status, location')
    expect((error as Error).message).toContain('metadata')
    expect((error as Error).message).not.toContain('ward-3')
    expect((error as FhirRequestError).outcome?.issue[0]?.diagnostics).toBe(
      'unsupported search parameter',
    )
  })

  test('a type the EHR does not serve is an error that says so', async () => {
    await sidecar()
    const error = await client()
      .search('Observation')
      .catch((e: unknown) => e)
    expect((error as Error).message).toContain(
      'The EHR does not serve Observation.',
    )
  })
})

describe('searchWithIncluded', () => {
  test('separates the matches from what came along, over all pages', async () => {
    const pages: Bundle<FhirResource>[] = [
      {
        resourceType: 'Bundle',
        type: 'searchset',
        link: [
          { relation: 'next', url: 'http://elsewhere.example/fhir?page=2' },
        ],
        entry: [
          { resource: encounter('e1'), search: { mode: 'match' } },
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
          { resource: encounter('e2'), search: { mode: 'match' } },
          { resource: encounter('e0'), search: { mode: 'include' } },
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
    const { seen } = await sidecar((s) =>
      s.url.startsWith('/fhir')
        ? { body: pages[s.url.includes('page=2') ? 1 : 0] }
        : undefined,
    )
    const fhir = client()
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
    expect(seen.map((s) => s.url)).toEqual([
      '/fhir/Encounter?_include=Encounter%3Aparticipant&_include=Encounter%3Apart-of',
      '/fhir?page=2',
    ])
    // search() gives the same matches and leaves the rest out.
    expect((await fhir.search('Encounter', params)).map((e) => e.id)).toEqual([
      'e1',
      'e2',
    ])
  })
})

describe('create, update and delete', () => {
  test('creates with a POST of the resource', async () => {
    const { seen } = await sidecar((s) =>
      s.method === 'POST'
        ? { status: 201, body: { ...JSON.parse(s.body), id: 'b1' } }
        : undefined,
    )
    const made = await client().create<Basic>({
      resourceType: 'Basic',
      code: { text: 'settings' },
    })
    expect(made.id).toBe('b1')
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/fhir/Basic',
      headers: { 'content-type': 'application/fhir+json' },
    })
  })

  test('an update sends the version it is based on', async () => {
    const { seen } = await sidecar((s) =>
      s.method === 'PUT' ? { body: JSON.parse(s.body) } : undefined,
    )
    await client().update(encounter('encounter-1', '3'))
    expect(seen[0]).toMatchObject({
      method: 'PUT',
      url: '/fhir/Encounter/encounter-1',
      headers: { 'if-match': 'W/"3"' },
    })
    expect(() =>
      client().update({ resourceType: 'Encounter' } as never),
    ).toThrow(TypeError)
  })

  test('says what to do when the version is outdated or missing', async () => {
    let status = 412
    await sidecar((s) => (s.method === 'PUT' ? { status } : undefined))
    const stale = await client()
      .update(encounter('encounter-1'))
      .catch((e: unknown) => e)
    expect((stale as Error).message).toContain('read it again')
    status = 428
    const blind = await client()
      .update(encounter('encounter-1'))
      .catch((e: unknown) => e)
    expect((blind as Error).message).toContain('meta.versionId')
  })

  test('an interaction the EHR does not have for a type says so', async () => {
    await sidecar(() => ({ status: 400, body: outcome('not-supported') }))
    const error = await client()
      .update({ resourceType: 'Patient', id: 'patient-1' })
      .catch((e: unknown) => e)
    expect((error as Error).message).toContain(
      'does not support this interaction for Patient',
    )
  })

  test('deletes by resource or by type and id, with the version', async () => {
    const { seen } = await sidecar((s) =>
      s.method === 'DELETE' ? { status: 204 } : undefined,
    )
    await client().delete(encounter('encounter-1', '2'))
    await client().delete('Basic', 'b1', { version: '5' })
    expect(seen.map((s) => [s.method, s.url, s.headers['if-match']])).toEqual([
      ['DELETE', '/fhir/Encounter/encounter-1', 'W/"2"'],
      ['DELETE', '/fhir/Basic/b1', 'W/"5"'],
    ])
  })
})

describe('request', () => {
  test('reaches anything under the FHIR base', async () => {
    const { seen } = await sidecar((s) =>
      s.url.startsWith('/fhir') ? { body: { resourceType: 'X' } } : undefined,
    )
    await client().request('GET', 'metadata')
    await client().request('GET', '/Encounter?status=finished')
    await client().request('GET', '')
    expect(seen.map((s) => s.url)).toEqual([
      '/fhir/metadata',
      '/fhir/Encounter?status=finished',
      '/fhir',
    ])
  })

  test('an operation the EHR does not have is an error without the path', async () => {
    await sidecar(() => ({ status: 400, body: outcome('not-supported') }))
    const error = await client()
      .request('GET', 'Patient/patient-1/$everything')
      .catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(400)
    expect((error as Error).message).not.toContain('patient-1')
  })

  test('sends the version of a write', async () => {
    const { seen } = await sidecar((s) =>
      s.method === 'PUT' ? { body: {} } : undefined,
    )
    await client().request(
      'PUT',
      'Encounter/encounter-1',
      encounter('encounter-1'),
      { version: '1' },
    )
    expect(seen[0]?.headers['if-match']).toBe('W/"1"')
  })

  test('cannot leave the FHIR base or this machine', async () => {
    await sidecar()
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
      expect(() => client().request('GET', path), path).toThrow(TypeError)
    }
  })
})

describe('filing a document', () => {
  test('files it for the launched patient, without a date', async () => {
    const { seen } = await sidecar((s) =>
      s.method === 'POST'
        ? { status: 201, body: { ...JSON.parse(s.body), id: 'd1' } }
        : undefined,
    )
    const saved = await createDocumentReference(client(), {
      type: 'report',
      title: 'Synthetic note',
      contentType: 'text/plain',
      data: 'Nothing real.',
    })
    expect(saved.subject?.reference).toBe('Patient/patient-1')
    expect(saved).not.toHaveProperty('date')
    expect(saved).not.toHaveProperty('context')
    expect(saved.content[0]?.attachment.data).toBe(
      Buffer.from('Nothing real.').toString('base64'),
    )
    expect(seen.at(-1)?.url).toBe('/fhir/DocumentReference')
  })

  test('refuses a document over 10 MiB before sending it', async () => {
    const { seen } = await sidecar()
    await expect(
      createDocumentReference(client(), {
        type: 'report',
        title: 'Too large',
        contentType: 'application/octet-stream',
        data: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toBeInstanceOf(RangeError)
    expect(seen).toEqual([])
  })

  test('without a patient it is not launched', async () => {
    await sidecar(undefined, { ...SESSION, patient: null })
    await expect(
      createDocumentReference(client(), {
        type: 'report',
        title: 'Note',
        contentType: 'text/plain',
        data: 'x',
      }),
    ).rejects.toBeInstanceOf(NotLaunchedError)
  })

  test('passes on the EHR’s refusal with its outcome', async () => {
    await sidecar(() => ({ status: 422, body: outcome('invalid') }))
    const error = await client()
      .create({
        resourceType: 'DocumentReference',
        status: 'current',
        date: '2026-11-14T10:00:00Z',
        content: [{ attachment: { contentType: 'text/plain', data: 'eA==' } }],
      })
      .catch((e: unknown) => e)
    expect((error as FhirRequestError).status).toBe(422)
    expect((error as FhirRequestError).outcome?.resourceType).toBe(
      'OperationOutcome',
    )
  })
})

test('only ever talks to this machine', async () => {
  vi.stubEnv('EHR_SIDECAR_URL', 'https://example.org')
  await expect(client().context()).rejects.toThrow('loopback')
})
