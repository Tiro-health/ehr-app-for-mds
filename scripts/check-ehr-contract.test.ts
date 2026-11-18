// @vitest-environment node
import { readFileSync } from 'node:fs'
import {
  composeProblems,
  composeScopes,
  manifestProblems,
  reservedAmong,
  routePaths,
} from './check-ehr-contract.mjs'

test('finds pages on the addresses that belong to the platform', () => {
  expect(reservedAmong(['/', '/not-launched', '/scores'])).toEqual([])
  expect(
    reservedAmong(['/', '/launch', '/Callback/', '/.well-known/jwks.json']),
  ).toEqual(['/launch', '/Callback/', '/.well-known/jwks.json'])
})

test('reads page addresses from the generated route list', () => {
  const source = `
export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/launch': typeof LaunchRoute
}
export interface FileRoutesByTo {
  '/other': typeof OtherRoute
}`
  expect(routePaths(source)).toEqual(['/', '/launch'])
})

test('accepts the manifest of the template', () => {
  const manifest = JSON.parse(readFileSync('smart.json', 'utf8'))
  expect(manifestProblems(manifest)).toEqual([])
})

test('explains what is wrong with a manifest', () => {
  expect(manifestProblems({ scopes: ['launch'] })).toEqual([
    '"requiresPatient" must be true or false.',
  ])
  expect(
    manifestProblems({ requiresPatient: true, scopes: ['patient/Patient.rs'] }),
  ).toEqual(['"scopes" must contain "launch".'])
  const [problem] = manifestProblems({
    requiresPatient: true,
    scopes: ['launch', 'system/Patient.rs'],
  })
  expect(problem).toContain('"system/Patient.rs" is not a scope')
  expect(
    manifestProblems({ requiresPatient: true, scopes: ['launch', 'launch'] }),
  ).toEqual(['"scopes" lists the same scope twice.'])
})

test('accepts a filtered scope, as the FHIR guide writes it', () => {
  const scope =
    'user/Basic.rs?code=urn:tiro-health:basic-kind|api-key&provider=gemini'
  expect(
    manifestProblems({ requiresPatient: false, scopes: ['launch', scope] }),
  ).toEqual([])
  const [problem] = manifestProblems({
    requiresPatient: false,
    scopes: ['launch', 'user/Basic.?code=x'],
  })
  expect(problem).toContain('is not a scope')
})

test('the local sidecar grants the scopes of smart.json', () => {
  const manifest = JSON.parse(readFileSync('smart.json', 'utf8'))
  const granted = composeScopes(readFileSync('compose.yaml', 'utf8'))
  expect(composeProblems(manifest.scopes, granted)).toEqual([])
})

test('names a scope compose.yaml lacks or has too many', () => {
  const granted = composeScopes(
    "    environment:\n      SMART_SCOPES: 'patient/Patient.rs user/Basic.rs'\n",
  )
  expect(granted).toEqual(['patient/Patient.rs', 'user/Basic.rs'])
  const problems = composeProblems(
    ['launch', 'openid', 'patient/Patient.rs', 'patient/Encounter.rs'],
    granted,
  )
  expect(problems).toHaveLength(2)
  expect(problems[0]).toContain('lacks "patient/Encounter.rs"')
  expect(problems[1]).toContain('has "user/Basic.rs"')
  expect(composeProblems(['launch'], null)[0]).toContain('no SMART_SCOPES')
})
