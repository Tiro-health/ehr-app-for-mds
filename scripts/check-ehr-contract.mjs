// Part of `pnpm check`. Verifies the two things the hosting platform relies on:
//
// 1. smart.json states which EHR permissions (scopes) the app asks for.
// 2. The app defines no page on the addresses the platform keeps for itself. The platform
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
  console.log('✓ smart.json and reserved addresses are in order')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
