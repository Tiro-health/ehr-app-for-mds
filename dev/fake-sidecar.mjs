// A pretend version of the EHR sidecar, for local preview and tests only.
//
// On the hosting platform a sidecar runs beside the app: it has the public port, does the
// launch from the EHR, holds the session, and serves the clinic's FHIR API to the app on
// loopback. This file imitates that with invented data (see synthetic-data.mjs), so the app
// can be previewed "as launched" without an EHR. It is never deployed.
//
// It follows the same contract as the real one:
// - public port: GET /launch, GET /callback and GET /.well-known/jwks.json are its own,
//   everything else is passed on to the app unchanged;
// - loopback port: GET /session and ANY /fhir/<path>, identified by the browser's Cookie
//   header, which the app forwards as is.

import http from 'node:http'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

// Search parameters the clinic's FHIR API accepts. Anything else is answered with 400.
const SEARCH_PARAMS = {
  Patient: ['gender', 'family', 'given', 'identifier'],
  Encounter: ['status', 'class'],
  DocumentReference: ['patient', 'subject', 'identifier'],
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
 * @param {string[]} [options.scopes] scopes a launch grants; default: those in smart.json
 * @param {boolean} [options.autoLaunch] launch on the first page visit instead of on /launch
 * @param {number} [options.pageSize] resources per search page
 */
export async function startFakeSidecar(options = {}) {
  const {
    publicPort = 3001,
    apiPort = 8081,
    appUrl = 'http://127.0.0.1:3000',
    scopes = readManifest().scopes,
    autoLaunch = false,
    pageSize = 20,
  } = options

  /** @type {Map<string, any>} */
  const sessions = new Map()
  /** @type {any[]} */
  const documents = []
  const app = new URL(appUrl)
  const syntheticResources = [...patients, ...encounters, ...otherResources]

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

    const wanted = url.searchParams.get('patient') ?? patients[0].id
    const patient = patients.find((p) => p.id === wanted)
    if (!patient) return redirect(res, '/not-launched?reason=no-patient')

    const current = encounters.find(
      (e) =>
        e.status === 'in-progress' &&
        e.subject.reference === `Patient/${patient.id}`,
    )
    const id = randomUUID()
    sessions.set(id, {
      patient: patient.id,
      encounter: current?.id ?? null,
      practitioner: practitioner.id,
      fhirUser: `Practitioner/${practitioner.id}`,
      fhirVersion: '4.0.1',
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
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('The app is not running yet. Try again in a moment.')
    })
    req.pipe(upstream)
  }

  const publicServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sidecar')
    const reading = req.method === 'GET' || req.method === 'HEAD'

    if (reading && url.pathname === '/launch') return launch(url, res)
    if (reading && url.pathname === '/callback') {
      return redirect(res, '/not-launched?reason=not-from-ehr')
    }
    if (reading && url.pathname === '/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{"keys":[]}')
    }

    // A request that changes something must come from the app's own pages.
    const origin = req.headers.origin
    if (!reading && origin && origin !== `http://${req.headers.host}`) {
      res.writeHead(403, { 'content-type': 'application/json' })
      return res.end('{"error":"origin_refused"}')
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

  // Live reload in local preview uses a WebSocket; pass it through as well.
  publicServer.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(Number(app.port), app.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
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

  const granted = (session, type, interaction) =>
    session.scopes.some((scope) => {
      const match = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/.exec(
        scope,
      )
      if (!match) return false
      const [, , resource, rights] = match
      if (resource !== '*' && resource !== type) return false
      const letters =
        rights === '*' ? 'cruds' : rights === 'read' ? 'rs' : rights
      return letters.includes(interaction)
    })

  const inCompartment = (session, resource) => {
    const patient = `Patient/${session.patient}`
    if (resource.resourceType === 'Patient') {
      return resource.id === session.patient
    }
    return (
      resource.subject?.reference === patient ||
      resource.patient?.reference === patient
    )
  }

  const store = (type) =>
    type === 'DocumentReference'
      ? documents
      : syntheticResources.filter((r) => r.resourceType === type)

  const matches = (resource, name, value) => {
    switch (`${resource.resourceType}.${name}`) {
      case 'Patient.gender':
        return resource.gender === value
      case 'Patient.family':
        return resource.name?.some((n) => n.family === value)
      case 'Patient.given':
        return resource.name?.some((n) => n.given?.includes(value))
      case 'Patient.identifier':
      case 'DocumentReference.identifier':
        return resource.identifier?.some(
          (i) => i.value === value || `${i.system}|${i.value}` === value,
        )
      case 'Encounter.status':
        return resource.status === value
      case 'Encounter.class':
        return resource.class?.code === value
      case 'DocumentReference.patient':
      case 'DocumentReference.subject':
        return (
          resource.subject?.reference === value ||
          resource.subject?.reference === `Patient/${value}`
        )
      default:
        return false
    }
  }

  const search = (session, type, url, res, base) => {
    const all = store(type)

    let page = 1
    let found = all.filter((r) => inCompartment(session, r))
    for (const [name, value] of url.searchParams) {
      if (name === '_page') {
        page = Number(value) || 1
      } else if (SEARCH_PARAMS[type]?.includes(name)) {
        found = found.filter((r) => matches(r, name, value))
      } else {
        return outcome(res, 400, 'invalid', `Unknown parameter "${name}".`)
      }
    }

    const start = (page - 1) * pageSize
    const link = [
      { relation: 'self', url: `${base}${url.pathname}${url.search}` },
    ]
    if (start + pageSize < found.length) {
      const next = new URLSearchParams(url.searchParams)
      next.set('_page', String(page + 1))
      link.push({ relation: 'next', url: `${base}${url.pathname}?${next}` })
    }
    json(res, 200, {
      resourceType: 'Bundle',
      type: 'searchset',
      total: found.length,
      link,
      entry: found.slice(start, start + pageSize).map((resource) => ({
        fullUrl: `${base}/fhir/${type}/${resource.id}`,
        resource,
        search: { mode: 'match' },
      })),
    })
  }

  const create = (session, type, body, res, base) => {
    let resource
    try {
      resource = JSON.parse(body)
    } catch {
      return outcome(res, 400, 'invalid', 'The body is not JSON.')
    }
    if (type !== 'DocumentReference' || resource.resourceType !== type) {
      return outcome(res, 404, 'not-supported', `Cannot create ${type} here.`)
    }
    if ('date' in resource || 'context' in resource) {
      return outcome(res, 422, 'invalid', 'Leave out "date" and "context".')
    }
    const kind = resource.type?.coding?.find(
      (c) => c.system === DOCUMENT_KIND_SYSTEM && c.code,
    )
    if (!kind) {
      return outcome(res, 422, 'required', 'A document kind is required.')
    }
    if (!inCompartment(session, resource)) {
      return outcome(res, 403, 'forbidden', 'Not the launched patient.')
    }
    const data = resource.content?.[0]?.attachment?.data
    if (typeof data !== 'string') {
      return outcome(res, 422, 'required', 'The file content is required.')
    }
    if (Buffer.byteLength(data, 'base64') > MAX_INLINE_BYTES) {
      return outcome(res, 413, 'too-long', 'The file is larger than 10 MiB.')
    }
    const saved = {
      ...resource,
      id: randomUUID(),
      meta: { versionId: '1', lastUpdated: new Date().toISOString() },
    }
    documents.push(saved)
    json(res, 201, saved, {
      location: `${base}/fhir/DocumentReference/${saved.id}`,
    })
  }

  const fhir = (session, req, url, body, res) => {
    const base = `http://${req.headers.host}`
    const [type, id, ...rest] = url.pathname.split('/').slice(2)
    if (!type || rest.length > 0) {
      return outcome(res, 404, 'not-found', 'Unknown address.')
    }
    const interaction =
      req.method === 'POST' ? 'c' : req.method === 'GET' ? (id ? 'r' : 's') : ''
    if (!interaction) {
      return outcome(res, 405, 'not-supported', 'Method not supported.')
    }
    if (!granted(session, type, interaction)) {
      return outcome(res, 403, 'forbidden', 'Insufficient scope.')
    }
    if (interaction === 'c') return create(session, type, body, res, base)
    if (interaction === 's') return search(session, type, url, res, base)

    const resource = store(type).find((r) => r.id === id)
    if (!resource || !inCompartment(session, resource)) {
      return outcome(res, 404, 'not-found', `${type} not found.`)
    }
    json(res, 200, resource)
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
