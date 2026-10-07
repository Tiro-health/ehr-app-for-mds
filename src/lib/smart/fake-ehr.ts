/**
 * An in-memory EHR for tests: SMART discovery, a token endpoint and an App State endpoint
 * that follows the rules of https://hl7.org/fhir/smart-app-launch/app-state.html
 */

type Basic = {
  resourceType: 'Basic'
  id?: string
  meta?: { versionId?: string }
  subject?: { reference: string }
  code: { coding: { system: string; code: string }[] }
  extension?: { url: string; valueString?: string }[]
}

export const ISS = 'https://ehr.example.org/fhir'
export const APP_STATE = 'https://ehr.example.org/appstate'

export function fakeEhr(
  options: { associatedEndpoint?: boolean; appState?: boolean } = {},
) {
  const store = new Map<string, Basic>()
  const tokenRequests: { auth: string | null; form: URLSearchParams }[] = []
  let nextId = 1000
  const appStateBase = options.associatedEndpoint ? APP_STATE : ISS
  const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })

  const fetchImpl = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)

    if (url.href === `${ISS}/.well-known/smart-configuration`) {
      const supports = options.appState !== false
      return json(200, {
        authorization_endpoint: 'https://ehr.example.org/authorize',
        token_endpoint: 'https://ehr.example.org/token',
        capabilities:
          supports && !options.associatedEndpoint ? ['smart-app-state'] : [],
        ...(supports && options.associatedEndpoint
          ? {
              associated_endpoints: [
                { url: APP_STATE, capabilities: ['smart-app-state'] },
              ],
            }
          : {}),
      })
    }

    if (url.href === 'https://ehr.example.org/token') {
      const form = new URLSearchParams(String(init.body))
      tokenRequests.push({ auth: headers.get('Authorization'), form })
      const idToken = [
        'e30',
        btoa(JSON.stringify({ fhirUser: 'Practitioner/123' })),
        'sig',
      ].join('.')
      return json(200, {
        access_token: `token-${tokenRequests.length}`,
        refresh_token: 'refresh-1',
        expires_in: 3600,
        id_token: idToken,
      })
    }

    if (!url.href.startsWith(`${appStateBase}/Basic`)) return json(404, {})
    if (!headers.get('Authorization')?.startsWith('Bearer '))
      return json(401, {})
    const id = url.pathname.split('/Basic/')[1]

    if (method === 'GET' && !id) {
      const [system, code] = (url.searchParams.get('code') ?? '').split('|')
      const subject = url.searchParams.get('subject')
      const entry = [...store.values()]
        .filter(
          (r) =>
            r.code.coding[0].system === system &&
            r.code.coding[0].code === code &&
            r.subject?.reference === subject,
        )
        .map((resource) => ({ resource }))
      return json(200, { resourceType: 'Bundle', type: 'searchset', entry })
    }
    if (method === 'GET' && id) {
      const r = store.get(id)
      return r ? json(200, r) : json(404, {})
    }
    if (method === 'POST') {
      const r = JSON.parse(String(init.body)) as Basic
      if (r.id || r.meta?.versionId) return json(400, {})
      const saved = { ...r, id: String(nextId++), meta: { versionId: 'a' } }
      store.set(saved.id, saved)
      return json(201, saved, {
        Location: `${appStateBase}/Basic/${saved.id}`,
        ETag: 'W/"a"',
      })
    }
    if (method === 'PUT') {
      const existing = store.get(id)
      const r = JSON.parse(String(init.body)) as Basic
      const ifMatch = headers.get('If-Match')
      if (
        !existing ||
        ifMatch !== `W/"${existing.meta?.versionId}"` ||
        r.id !== id ||
        r.subject?.reference !== existing.subject?.reference ||
        JSON.stringify(r.code) !== JSON.stringify(existing.code)
      ) {
        return json(412, {})
      }
      const version = String.fromCharCode(
        existing.meta!.versionId!.charCodeAt(0) + 1,
      )
      const saved = { ...r, meta: { versionId: version } }
      store.set(id, saved)
      return json(200, saved, { ETag: `W/"${version}"` })
    }
    return json(405, {})
  }

  return { fetch: fetchImpl as typeof fetch, store, tokenRequests }
}
