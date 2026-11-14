// A pretend version of the EHR sidecar, for local preview and tests only.
//
// On the hosting platform a sidecar runs beside the app: it has the public port, does the
// launch from the EHR, holds the session, and serves the clinic's FHIR API to the app on
// loopback. This file imitates that with invented data (see synthetic-data.mjs), so the app
// can be previewed "as launched" without an EHR. It is never deployed.
//
// It follows the same contract as the real one (smart-sidecar/README.md in Tiro-health/ehr):
// - public port: GET /launch, GET /callback and GET /.well-known/jwks.json are its own,
//   everything else is passed on to the app unchanged, visitors without a session included;
// - loopback port: GET /session and ANY /fhir/<path>, identified by the browser's Cookie
//   header, which the app forwards as is.
//
// Behind /fhir it answers as the Tiro EHR's FHIR API does: the resource types, interactions
// and search parameters in facade-capabilities.mjs, a version (If-Match) on every update,
// 404 for a type it does not serve, 403 for a scope that was not granted. A type the real EHR
// does not serve but that has invented data in synthetic-data.mjs can be read and searched.
//
// Where it knowingly differs: GET /launch needs no EHR. It starts a session for an invented
// patient straight away (`?patient=<id>` picks one, `?user=none` launches without a known
// user, `?fail=<reason>` refuses the launch).

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RESULT_PARAMS, SERVED } from './facade-capabilities.mjs'
import {
  DOCUMENT_KIND_SYSTEM,
  encounters,
  otherResources,
  patients,
  practitioner,
} from './synthetic-data.mjs'

export const SESSION_COOKIE = '__Host-smart'

export const REASON_CODES = [
  'not-from-ehr',
  'unknown-ehr',
  'ehr-unreachable',
  'ehr-failed',
  'ehr-refused',
  'expired',
  'no-identity',
  'identity-invalid',
  'no-patient',
  'scope-missing',
]

const MAX_INLINE_BYTES = 10 * 1024 * 1024
const FHIR_JSON = 'application/fhir+json; charset=utf-8'

const INTERACTION_CODES = {
  r: 'read',
  s: 'search-type',
  c: 'create',
  u: 'update',
  d: 'delete',
}

function readManifest() {
  const file = new URL('../smart.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * @param {object} [options]
 * @param {number} [options.publicPort] port the browser talks to (0 picks a free one)
 * @param {number} [options.apiPort] loopback port the app talks to (0 picks a free one)
 * @param {string} [options.appUrl] where the app itself listens
 * @param {string[]} [options.scopes] scopes the clinic grants; default: all those in smart.json
 * @param {boolean} [options.autoLaunch] launch on the first page visit instead of on /launch
 * @param {number} [options.pageSize] resources per search page
 */
export async function startFakeSidecar(options = {}) {
  const {
    publicPort = 3001,
    apiPort = 8081,
    appUrl = 'http://127.0.0.1:3000',
    scopes: grantedByClinic,
    autoLaunch = false,
    pageSize = 20,
  } = options

  /** @type {Map<string, any>} */
  const sessions = new Map()
  const app = new URL(appUrl)

  // The app asks for the scopes in smart.json; the clinic may grant fewer. The three launch
  // scopes are always part of a session.
  const isResourceScope = (scope) => /^(patient|user|system)\//.test(scope)
  const asked = readManifest().scopes
  const clinicGrants = grantedByClinic ?? asked
  const scopes = [...new Set(['launch', 'openid', 'fhirUser', ...clinicGrants])]
  const noneGranted = !asked
    .filter(isResourceScope)
    .some((scope) => clinicGrants.includes(scope))
  // This instance's own copy of the invented data: what one preview changes, the next
  // start has forgotten.
  /** @type {any[]} */
  const resources = structuredClone([
    practitioner,
    ...patients,
    ...encounters,
    ...otherResources,
  ]).map((resource) => ({ meta: { versionId: '1' }, ...resource }))

  const sessionOf = (req) => {
    const header = req.headers.cookie ?? ''
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name === SESSION_COOKIE) return sessions.get(rest.join('='))
    }
    return undefined
  }

  // ---------------------------------------------------------------- public

  const redirect = (res, location, headers = {}) => {
    res.writeHead(302, { location, 'cache-control': 'no-store', ...headers })
    res.end()
  }

  const launch = (url, res) => {
    const fail = url.searchParams.get('fail')
    if (fail) return redirect(res, `/not-launched?reason=${fail}`)

    if (noneGranted) return redirect(res, '/not-launched?reason=scope-missing')

    const wanted = url.searchParams.get('patient') ?? patients[0].id
    const patient = patients.find((p) => p.id === wanted)
    if (!patient) return redirect(res, '/not-launched?reason=no-patient')

    const current = encounters.find(
      (e) =>
        e.status === 'in-progress' &&
        e.subject.reference === `Patient/${patient.id}`,
    )
    const knownUser = url.searchParams.get('user') !== 'none'
    const id = randomUUID()
    sessions.set(id, {
      patient: patient.id,
      encounter: current?.id ?? null,
      practitioner: knownUser ? practitioner.id : null,
      fhirUser: knownUser ? `Practitioner/${practitioner.id}` : null,
      fhirVersion: 'R4',
      scopes,
      intent: null,
    })
    redirect(res, '/', {
      'set-cookie': `${SESSION_COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    })
  }

  const proxy = (req, res) => {
    const upstream = http.request(
      {
        host: app.hostname,
        port: app.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (answer) => {
        // The session cookie is the sidecar's alone: the app cannot set or clear it.
        const cookies = answer.headers['set-cookie']?.filter(
          (cookie) => !cookie.trimStart().startsWith(`${SESSION_COOKIE}=`),
        )
        const headers = { ...answer.headers }
        if (cookies?.length) headers['set-cookie'] = cookies
        else delete headers['set-cookie']
        res.writeHead(answer.statusCode ?? 502, headers)
        answer.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' })
      }
      res.end('{"error":"app_unavailable"}')
    })
    req.pipe(upstream)
  }

  const publicServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sidecar')
    const reading = req.method === 'GET' || req.method === 'HEAD'

    if (url.pathname === '/launch' || url.pathname === '/callback') {
      if (!reading) {
        res.writeHead(405, { allow: 'GET, HEAD' })
        return res.end()
      }
      return url.pathname === '/launch'
        ? launch(url, res)
        : redirect(res, '/not-launched?reason=not-from-ehr')
    }
    if (reading && url.pathname === '/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{"keys":[]}')
    }

    // A request that changes something must come from the app's own pages.
    const origin = req.headers.origin
    if (!reading && origin && origin !== `http://${req.headers.host}`) {
      res.writeHead(403, { 'content-type': 'application/json' })
      return res.end('{"error":"cross_origin"}')
    }

    const visitingPage =
      req.method === 'GET' &&
      (req.headers.accept ?? '').includes('text/html') &&
      url.pathname !== '/not-launched'
    if (autoLaunch && visitingPage && !sessionOf(req)) {
      return redirect(res, '/launch')
    }

    proxy(req, res)
  })

  // ---------------------------------------------------------------- loopback

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'content-type': FHIR_JSON,
      'cache-control': 'no-store',
      ...headers,
    })
    res.end(JSON.stringify(body))
  }

  const outcome = (res, status, code, diagnostics) =>
    json(res, status, {
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code, diagnostics }],
    })

  // The level ("user" or "patient") at which the session may do this, or undefined.
  const granted = (session, type, interaction) => {
    const levels = session.scopes.flatMap((scope) => {
      const match = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/.exec(
        scope,
      )
      if (!match) return []
      const [, level, resource, rights] = match
      if (resource !== '*' && resource !== type) return []
      const letters =
        rights === '*'
          ? 'cruds'
          : rights === 'read'
            ? 'rs'
            : rights === 'write'
              ? 'cud'
              : rights
      return letters.includes(interaction) ? [level] : []
    })
    return levels.find((level) => level !== 'patient') ?? levels[0]
  }

  // A patient-level scope reaches only what belongs to the launched patient.
  const reachable = (session, level, resource) => {
    if (level !== 'patient') return true
    const patient = `Patient/${session.patient}`
    if (resource.resourceType === 'Patient') {
      return resource.id === session.patient
    }
    return [resource.subject, resource.patient, resource.beneficiary].some(
      (reference) => reference?.reference === patient,
    )
  }

  // What the pretend EHR serves: the real EHR's types, plus any type that has invented data.
  const serving = (type) =>
    SERVED[type] ??
    (resources.some((r) => r.resourceType === type)
      ? { interactions: 'rs', params: ['_id', 'patient', 'subject'] }
      : undefined)

  const refersTo = (reference, value) =>
    reference?.reference === value ||
    reference?.reference?.endsWith(`/${value}`)

  const onDate = (start, value) => {
    const [, prefix = 'eq', date] = /^(eq|ge|le|gt|lt)?(.+)$/.exec(value) ?? []
    if (!date || !start) return false
    const day = start.slice(0, date.length)
    return {
      eq: day === date,
      ge: day >= date,
      le: day <= date,
      gt: day > date,
      lt: day < date,
    }[prefix]
  }

  // Exact matches only, as in the real EHR.
  const matches = (resource, name, value) => {
    switch (name) {
      case '_id':
        return resource.id === value
      case 'gender':
      case 'status':
        return resource[name] === value
      case 'family':
        return resource.name?.some((n) => n.family === value)
      case 'given':
        return resource.name?.some((n) => n.given?.includes(value))
      case 'identifier':
        return [resource.identifier ?? []]
          .flat()
          .some((i) => i.value === value || `${i.system}|${i.value}` === value)
      case 'class':
        return resource.class?.code === value
      case 'code':
        return resource.code?.coding?.some(
          (c) => c.code === value || `${c.system}|${c.code}` === value,
        )
      case 'date':
      case 'date-start':
        return onDate(resource.period?.start, value)
      case 'patient':
        return [resource.subject, resource.patient, resource.beneficiary].some(
          (reference) => refersTo(reference, value),
        )
      default:
        return refersTo(resource[name], value)
    }
  }

  // The real EHR tells an app as little as this about a type it does not serve (404) or a
  // request the granted scopes do not cover (403).
  const refused = (res, status) =>
    outcome(
      res,
      status,
      'processing',
      `The request could not be completed. Reference: ${randomUUID()}`,
    )

  const unsupported = (res, method) =>
    outcome(
      res,
      400,
      'not-supported',
      `Invalid request: The FHIR endpoint on this server does not know how to handle ${method} operation`,
    )

  const search = (session, level, type, url, res, base) => {
    let count = pageSize
    let offset = 0
    let found = resources.filter(
      (r) => r.resourceType === type && reachable(session, level, r),
    )
    for (const [name, value] of url.searchParams) {
      if (name === '_count') count = Number(value) || pageSize
      else if (name === '_offset') offset = Number(value) || 0
      else if (RESULT_PARAMS.includes(name)) continue
      else if (serving(type).params.includes(name)) {
        found = found.filter((r) => matches(r, name, value))
      } else {
        return outcome(res, 400, 'processing', 'unsupported search parameter')
      }
    }

    const link = [
      { relation: 'self', url: `${base}${url.pathname}${url.search}` },
    ]
    if (offset + count < found.length) {
      const next = new URLSearchParams(url.searchParams)
      next.set('_count', String(count))
      next.set('_offset', String(offset + count))
      link.push({ relation: 'next', url: `${base}${url.pathname}?${next}` })
    }
    json(res, 200, {
      resourceType: 'Bundle',
      type: 'searchset',
      total: found.length,
      link,
      entry: found.slice(offset, offset + count).map((resource) => ({
        fullUrl: `${base}/fhir/${type}/${resource.id}`,
        resource,
        search: { mode: 'match' },
      })),
    })
  }

  // What the real EHR checks before it files a document.
  const documentProblem = (res, resource) => {
    const problem = (status, code, text) => {
      outcome(res, status, code, text)
      return true
    }
    if ('date' in resource || 'context' in resource) {
      return problem(422, 'invalid', 'Leave out "date" and "context".')
    }
    const kind = resource.type?.coding?.find(
      (c) => c.system === DOCUMENT_KIND_SYSTEM && c.code,
    )
    if (!kind) {
      return problem(422, 'required', 'A document kind is required.')
    }
    const data = resource.content?.[0]?.attachment?.data
    if (typeof data !== 'string') {
      return problem(422, 'required', 'The file content is required.')
    }
    if (Buffer.byteLength(data, 'base64') > MAX_INLINE_BYTES) {
      return problem(413, 'too-long', 'The file is larger than 10 MiB.')
    }
    return false
  }

  const parsed = (res, type, body) => {
    try {
      const resource = JSON.parse(body)
      if (resource?.resourceType === type) return resource
    } catch {
      // answered below
    }
    outcome(res, 400, 'invalid', `The body is not a ${type}.`)
    return undefined
  }

  // The version a write is based on, from If-Match: W/"<versionId>".
  const basedOn = (req, res, required) => {
    const header = req.headers['if-match']
    if (!header) {
      if (!required) return { version: undefined }
      outcome(
        res,
        428,
        'processing',
        'This server requires If-Match on every update: send the ETag of the version you read, as W/"<versionId>"',
      )
      return undefined
    }
    const match = /^(?:W\/)?"([1-9][0-9]{0,8})"$/.exec(header.trim())
    if (match) return { version: match[1] }
    outcome(res, 400, 'processing', 'If-Match must name one version.')
    return undefined
  }

  const stale = (res, version) =>
    outcome(
      res,
      412,
      'processing',
      `The resource has changed since version ${version}; read it again and retry`,
    )

  const create = (session, level, type, body, res, base) => {
    const resource = parsed(res, type, body)
    if (!resource) return
    if (type === 'DocumentReference' && documentProblem(res, resource)) return
    if (!reachable(session, level, resource)) return refused(res, 403)
    const saved = {
      ...resource,
      id: randomUUID(),
      meta: { versionId: '1', lastUpdated: new Date().toISOString() },
    }
    resources.push(saved)
    json(res, 201, saved, {
      location: `${base}/fhir/${type}/${saved.id}`,
      etag: 'W/"1"',
    })
  }

  const update = (session, level, type, id, req, body, res) => {
    const resource = parsed(res, type, body)
    if (!resource) return
    if (resource.id !== id) {
      return outcome(res, 400, 'processing', `${type}.id must equal the id.`)
    }
    const based = basedOn(req, res, true)
    if (!based) return
    const at = resources.findIndex(
      (r) => r.resourceType === type && r.id === id,
    )
    if (at < 0 || !reachable(session, level, resources[at])) {
      return refused(res, 404)
    }
    if (!reachable(session, level, resource)) return refused(res, 403)
    const current = resources[at].meta.versionId
    if (based.version !== current) return stale(res, based.version)
    const versionId = String(Number(current) + 1)
    resources[at] = {
      ...resource,
      meta: { versionId, lastUpdated: new Date().toISOString() },
    }
    json(res, 200, resources[at], { etag: `W/"${versionId}"` })
  }

  const remove = (session, level, type, id, req, res) => {
    const based = basedOn(req, res, serving(type).deleteNeedsVersion === true)
    if (!based) return
    const at = resources.findIndex(
      (r) => r.resourceType === type && r.id === id,
    )
    if (at < 0 || !reachable(session, level, resources[at])) {
      return refused(res, 404)
    }
    const current = resources[at].meta.versionId
    if (based.version && based.version !== current) {
      return stale(res, based.version)
    }
    resources.splice(at, 1)
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
  }

  const capabilities = (res) =>
    json(res, 200, {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: '2026-11-14',
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      rest: [
        {
          mode: 'server',
          resource: Object.entries(SERVED).map(([type, served]) => ({
            type,
            interaction: [...served.interactions].map((letter) => ({
              code: INTERACTION_CODES[letter],
            })),
            searchParam: served.params.map((name) => ({ name })),
          })),
        },
      ],
    })

  const fhir = (session, req, url, body, res) => {
    const base = `http://${req.headers.host}`
    const [type, id, ...rest] = url.pathname.split('/').slice(2)
    if (req.method === 'GET' && type === 'metadata' && !id) {
      return capabilities(res)
    }
    const served = type ? serving(type) : undefined
    if (!served) return refused(res, 404)

    const interaction =
      rest.length > 0 || id?.startsWith('$') || id?.startsWith('_')
        ? undefined
        : ({ GET: id ? 'r' : 's', POST: id ? undefined : 'c' }[req.method] ??
          (id ? { PUT: 'u', DELETE: 'd' }[req.method] : undefined))
    if (!interaction || !served.interactions.includes(interaction)) {
      return unsupported(res, req.method)
    }
    const level = granted(session, type, interaction)
    if (!level) return refused(res, 403)

    if (interaction === 'c') {
      return create(session, level, type, body, res, base)
    }
    if (interaction === 's') {
      return search(session, level, type, url, res, base)
    }
    if (interaction === 'u') {
      return update(session, level, type, id, req, body, res)
    }
    if (interaction === 'd') return remove(session, level, type, id, req, res)

    const resource = resources.find(
      (r) => r.resourceType === type && r.id === id,
    )
    if (!resource || !reachable(session, level, resource)) {
      return refused(res, 404)
    }
    json(res, 200, resource, { etag: `W/"${resource.meta.versionId}"` })
  }

  const apiServer = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://sidecar')
      const session = sessionOf(req)
      const isFhir = url.pathname.startsWith('/fhir/')
      if (url.pathname !== '/session' && !isFhir) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{"error":"not_found"}')
      }
      if (!session) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end('{"error":"no_session"}')
      }
      const segments = url.pathname.split('/').slice(2)
      if (isFhir && !segments.every((s) => /^[A-Za-z0-9._$~-]+$/.test(s))) {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end('{"error":"invalid_path"}')
      }
      if (!isFhir) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        return res.end(JSON.stringify(session))
      }
      fhir(session, req, url, Buffer.concat(chunks).toString('utf8'), res)
    })
  })

  // ---------------------------------------------------------------- start

  const listen = (server, port) =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => resolve(server.address().port))
    })

  const publicUrl = `http://localhost:${await listen(publicServer, publicPort)}`
  const apiUrl = `http://127.0.0.1:${await listen(apiServer, apiPort)}`

  return {
    publicUrl,
    apiUrl,
    /** Does a launch and returns the Cookie header a browser would then send. */
    async launch(query = '') {
      const answer = await fetch(`${publicUrl}/launch${query}`, {
        redirect: 'manual',
      })
      return (answer.headers.get('set-cookie') ?? '').split(';')[0]
    },
    /** Ends every session, as when the EHR session expires. */
    endSessions() {
      sessions.clear()
    },
    async close() {
      for (const server of [publicServer, apiServer]) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    },
  }
}
