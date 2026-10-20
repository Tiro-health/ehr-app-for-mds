/**
 * The browser's side of the EHR connection: reads and writes go straight from the browser to
 * the EHR's FHIR server with the short-lived access token. When the token is about to run out,
 * or the EHR refuses it, Tiro's auth proxy is asked for a fresh one, once.
 */
import type { EhrConnection } from './connection'

export type Launched = Extract<EhrConnection, { status: 'launched' }>

/** Asks the auth proxy for the connection; `rejected` is a token the EHR just refused. */
export type Connect = (rejected?: string) => Promise<EhrConnection>

/** The EHR ended the sign-in; the clinician has to open the app from the EHR again. */
export class EhrDisconnected extends Error {
  constructor() {
    super('The connection to the EHR ended. Open the app from the EHR again.')
  }
}

/** A refusal from the EHR, with the FHIR OperationOutcome's text when it sent one. */
export class EhrError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const EXPIRY_MARGIN_SECONDS = 30

export class EhrClient {
  private connection: Launched
  private renewing: Promise<Launched> | null = null

  constructor(
    connection: Launched,
    private readonly connect: Connect,
    private readonly onEnded: () => void = () => {},
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.connection = connection
  }

  get fhirBase() {
    return this.connection.fhirBase
  }
  get patientId() {
    return this.connection.patient
  }
  get encounterId() {
    return this.connection.encounter
  }
  get fhirUser() {
    return this.connection.fhirUser
  }
  get appStateEndpoint() {
    return this.connection.appStateEndpoint
  }
  get scope() {
    return this.connection.scope
  }

  /** Whether the EHR granted a scope, e.g. `can('Encounter', 'c')`. */
  can(resourceType: string, interaction: 'c' | 'r' | 'u' | 'd' | 's') {
    return this.connection.scope.split(/\s+/).some((scope) => {
      const match =
        /^(patient|user|system)\/([A-Za-z*]+)\.([cruds]+|read|write|\*)/.exec(
          scope,
        )
      if (!match || (match[2] !== resourceType && match[2] !== '*'))
        return false
      const letters = match[3]
      if (letters === '*') return true
      if (letters === 'read') return interaction === 'r' || interaction === 's'
      if (letters === 'write')
        return interaction === 'c' || interaction === 'u' || interaction === 'd'
      return letters.includes(interaction)
    })
  }

  /**
   * fetch() against the EHR. `path` is relative to the FHIR base (`Patient/123`) or a full URL
   * on the EHR (App State may live on another endpoint).
   */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let connection = await this.current()
    const send = (token: string) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (!headers.has('Accept')) headers.set('Accept', 'application/fhir+json')
      return this.fetchImpl(this.url(path), { ...init, headers })
    }
    let res = await send(connection.accessToken)
    if (res.status === 401) {
      connection = await this.renew(connection.accessToken)
      res = await send(connection.accessToken)
      if (res.status === 401) {
        this.onEnded()
        throw new EhrDisconnected()
      }
    }
    return res
  }

  /** fetch() that expects JSON back and turns a refusal into an EhrError. */
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(path, init)
    if (!res.ok) throw await ehrError(res)
    return (await res.json()) as T
  }

  private url(path: string) {
    return /^https?:\/\//.test(path)
      ? path
      : `${this.connection.fhirBase}/${path.replace(/^\//, '')}`
  }

  private async current(): Promise<Launched> {
    const secondsLeft = this.connection.expiresAt - Date.now() / 1000
    if (secondsLeft > EXPIRY_MARGIN_SECONDS) return this.connection
    return this.renew()
  }

  /** One renewal at a time: the EHR revokes the sign-in when a refresh token is used twice. */
  private renew(rejected?: string): Promise<Launched> {
    this.renewing ??= this.connect(rejected)
      .then((next) => {
        if (next.status !== 'launched') {
          this.onEnded()
          throw new EhrDisconnected()
        }
        this.connection = next
        return next
      })
      .finally(() => {
        this.renewing = null
      })
    return this.renewing
  }
}

export async function ehrError(res: Response): Promise<EhrError> {
  let detail = ''
  try {
    const body = (await res.json()) as {
      issue?: { diagnostics?: string; details?: { text?: string } }[]
    }
    detail =
      body.issue
        ?.map((i) => i.diagnostics ?? i.details?.text)
        .filter(Boolean)
        .join('; ') ?? ''
  } catch {
    // Not JSON; the status says enough.
  }
  return new EhrError(
    res.status,
    `The EHR answered ${res.status}${detail ? `: ${detail}` : ''}.`,
  )
}
