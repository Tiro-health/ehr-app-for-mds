// @vitest-environment node
import { readFileSync } from 'node:fs'
import {
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
