// Part of `pnpm check`. Verifies the things the hosting platform and the local EHR rely on:
//
// 1. smart.json states which EHR permissions (scopes) the app needs. The platform does not
//    read it yet (it uses the app's registration in the EHR).
// 2. compose.yaml grants the local sidecar the same scopes, so the local preview refuses
//    what the app did not ask for.
// 3. The app defines no page on the addresses the platform keeps for itself. The platform
//    handles the launch from the EHR on those; a page there would never be reached and
//    would mean the app is trying to do the platform's job.

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const RESERVED_PATHS = ['/launch', '/callback', '/.well-known/jwks.json']

const SCOPE =
  /^(launch|launch\/patient|launch\/encounter|openid|fhirUser|profile|offline_access|online_access|(patient|user)\/([A-Z][A-Za-z]+|\*)\.c?r?u?d?s?)$/

const normalise = (path) => path.toLowerCase().replace(/\/+$/, '') || '/'

/** The reserved addresses among `paths`. */
export function reservedAmong(paths) {
  return paths.filter((path) => RESERVED_PATHS.includes(normalise(path)))
}

/** The addresses of all pages, read from the generated route list. */
export function routePaths(routeTreeSource) {
  const block = /interface FileRoutesByFullPath \{([^}]*)\}/.exec(
    routeTreeSource,
  )
  return [...(block?.[1] ?? '').matchAll(/'([^']+)'\s*:/g)].map((m) => m[1])
}

/** What is wrong with the manifest, as sentences. Empty when it is fine. */
export function manifestProblems(manifest) {
  if (typeof manifest !== 'object' || manifest === null) {
    return ['smart.json must be an object with "requiresPatient" and "scopes".']
  }
  const problems = []
  if (typeof manifest.requiresPatient !== 'boolean') {
    problems.push('"requiresPatient" must be true or false.')
  }
  const { scopes } = manifest
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return [...problems, '"scopes" must be a list with at least one scope.']
  }
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !SCOPE.test(scope) || /\.$/.test(scope)) {
      problems.push(
        `"${scope}" is not a scope the EHR knows. Examples: "patient/Observation.rs" (read and search), "patient/DocumentReference.c" (create).`,
      )
    }
  }
  if (new Set(scopes).size !== scopes.length) {
    problems.push('"scopes" lists the same scope twice.')
  }
  if (!scopes.includes('launch')) {
    problems.push('"scopes" must contain "launch".')
  }
  return problems
}

// Asked for by the sidecar on every launch, so not part of its SMART_SCOPES.
const LAUNCH_SCOPES = new Set([
  'launch',
  'launch/patient',
  'launch/encounter',
  'openid',
  'fhirUser',
  'profile',
])

/** The SMART_SCOPES compose.yaml gives the sidecar, or null when it sets none. */
export function composeScopes(composeSource) {
  const line = /^\s*SMART_SCOPES:\s*['"]?([^'"\n#]*)/m.exec(composeSource)
  return line ? line[1].trim().split(/\s+/).filter(Boolean) : null
}

/** What differs between the scopes of smart.json and those compose.yaml grants, as sentences. */
export function composeProblems(manifestScopes, granted) {
  if (granted === null) {
    return [
      'compose.yaml: the sidecar has no SMART_SCOPES. Restore it from the template.',
    ]
  }
  const wanted = manifestScopes.filter((scope) => !LAUNCH_SCOPES.has(scope))
  const missing = wanted.filter((scope) => !granted.includes(scope))
  const extra = granted.filter((scope) => !wanted.includes(scope))
  return [
    ...missing.map(
      (scope) =>
        `compose.yaml: SMART_SCOPES lacks "${scope}" from smart.json. Add it, then restart with \`docker compose up\`.`,
    ),
    ...extra.map(
      (scope) =>
        `compose.yaml: SMART_SCOPES has "${scope}", which smart.json does not list. Remove it, or add it to smart.json.`,
    ),
  ]
}

function main() {
  const problems = []

  if (!existsSync('smart.json')) {
    problems.push('smart.json is missing. Restore it from the template.')
  } else {
    try {
      const manifest = JSON.parse(readFileSync('smart.json', 'utf8'))
      problems.push(
        ...manifestProblems(manifest).map((p) => `smart.json: ${p}`),
      )
      if (Array.isArray(manifest?.scopes) && existsSync('compose.yaml')) {
        problems.push(
          ...composeProblems(
            manifest.scopes,
            composeScopes(readFileSync('compose.yaml', 'utf8')),
          ),
        )
      }
    } catch {
      problems.push('smart.json is not valid JSON.')
    }
  }

  const pages = existsSync('src/routeTree.gen.ts')
    ? routePaths(readFileSync('src/routeTree.gen.ts', 'utf8'))
    : []
  const files = RESERVED_PATHS.filter((path) => existsSync(`public${path}`))
  for (const path of [...reservedAmong(pages), ...files]) {
    problems.push(
      `The app defines "${path}", which belongs to the hosting platform. Remove that page or file: the platform does the launch from the EHR.`,
    )
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`)
    process.exit(1)
  }
  console.log('✓ smart.json, compose.yaml and reserved addresses are in order')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
