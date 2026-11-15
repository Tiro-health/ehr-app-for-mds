import type { Basic } from 'fhir/r4'
import { FhirRequestError } from '@/lib/fhir/errors'
import type { SearchParams } from '@/lib/fhir/sidecar-client'

/**
 * SMART App State: app data stored as FHIR Basic resources in the EHR.
 * https://hl7.org/fhir/smart-app-launch/app-state.html
 *
 * Every piece of state is one Basic resource, found by its state code (`Basic.code`) and its
 * subject (`Basic.subject`, here the signed-in practitioner). The value itself is JSON in a
 * single valueString extension. Runs on the server, through the `fhir` helper.
 */

/** The part of the `fhir` helper App State uses. */
export type AppStateFhir = {
  search: (type: 'Basic', params: SearchParams) => Promise<Basic[]>
  create: (resource: Basic) => Promise<Basic>
  update: (resource: Basic) => Promise<Basic>
}

export type AppStateTarget = {
  fhir: AppStateFhir
  /** Code system for the state codes. The app's own origin, as the spec recommends. */
  system: string
  /** Reference to the signed-in user, e.g. Practitioner/123 */
  subject: string
}

export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json }

export type StoredState = {
  id: string
  version: string
  value: Json | undefined
}

export type SaveResult =
  | { status: 'saved'; state: StoredState }
  | { status: 'conflict'; state: StoredState | null }

const MAX_BYTES = 256 * 1024

export function valueExtensionUrl(system: string) {
  return `${system.replace(/\/$/, '')}/app-state-value`
}

export async function readState(
  target: AppStateTarget,
  code: string,
): Promise<StoredState | null> {
  const found = await target.fhir.search('Basic', {
    code: `${target.system}|${code}`,
    subject: target.subject,
  })
  const match = found.find(
    (r) =>
      sameReference(r.subject?.reference, target.subject) &&
      r.code.coding?.some((c) => c.system === target.system && c.code === code),
  )
  return match ? toStored(match, target.system) : null
}

/**
 * Creates the state when `current` is null, otherwise updates that version of it. When someone
 * else saved first (a stale version, or a create when the state already exists) the result is
 * a conflict carrying the latest stored state.
 */
export async function writeState(
  target: AppStateTarget,
  code: string,
  value: Json,
  current: { id: string; version: string } | null,
): Promise<SaveResult> {
  const resource: Basic = {
    resourceType: 'Basic',
    ...(current
      ? { id: current.id, meta: { versionId: current.version } }
      : {}),
    subject: { reference: target.subject },
    code: { coding: [{ system: target.system, code }] },
    extension: [
      {
        url: valueExtensionUrl(target.system),
        valueString: JSON.stringify(value),
      },
    ],
  }
  if (new TextEncoder().encode(JSON.stringify(resource)).length > MAX_BYTES) {
    throw new Error('App state is larger than the 256 KB the EHR accepts.')
  }

  if (!current) {
    const existing = await readState(target, code)
    if (existing) return { status: 'conflict', state: existing }
  }
  try {
    const saved = current
      ? await target.fhir.update(resource)
      : await target.fhir.create(resource)
    return { status: 'saved', state: toStored(saved, target.system) }
  } catch (error) {
    if (
      error instanceof FhirRequestError &&
      (error.status === 412 || error.status === 409)
    ) {
      return { status: 'conflict', state: await readState(target, code) }
    }
    throw error
  }
}

/** The EHR may hand back `Practitioner/1` or an absolute URL: compare the type and id. */
function sameReference(reference: string | undefined, subject: string) {
  if (!reference) return false
  const tail = (r: string) => r.split('/').slice(-2).join('/')
  return tail(reference) === tail(subject)
}

function toStored(resource: Basic, system: string): StoredState {
  const version = resource.meta?.versionId
  if (!resource.id || !version) {
    throw new Error('The EHR returned app state without an id or version.')
  }
  const raw = resource.extension?.find(
    (e) => e.url === valueExtensionUrl(system),
  )?.valueString
  return { id: resource.id, version, value: parseValue(raw) }
}

/** The spec asks apps to treat stored values as untrusted: never throw on bad content. */
function parseValue(raw: string | undefined): Json | undefined {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as Json
  } catch {
    return undefined
  }
}
