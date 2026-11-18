import type { Basic, Patient } from 'fhir/r4'
import key from '../../../fixtures/r4/Basic-api-key-gemini.json'
import patient from '../../../fixtures/r4/Patient-patient-1.json'
import { apiKeyScope, apiKeyValue, isApiKey } from './api-key'

const gemini = key as Basic

test('finds the key of the service among the search results', () => {
  expect(apiKeyValue([gemini], 'gemini')).toBe('invented-key-for-the-local-ehr')
})

test('finds no key when the EHR has none', () => {
  expect(apiKeyValue([], 'gemini')).toBeNull()
})

test('ignores a key of another service', () => {
  const other: Basic = {
    ...gemini,
    extension: gemini.extension?.map((extension) =>
      'valueCode' in extension
        ? { ...extension, valueCode: 'other' }
        : extension,
    ),
  }
  expect(apiKeyValue([other], 'gemini')).toBeNull()
})

test('ignores a Basic of another kind, such as app state', () => {
  const state: Basic = {
    ...gemini,
    code: { coding: [{ system: 'https://app.example', code: 'settings' }] },
  }
  expect(isApiKey(state)).toBe(false)
  expect(apiKeyValue([state], 'gemini')).toBeNull()
})

test('recognises a key, and nothing else, as a key', () => {
  expect(isApiKey(gemini)).toBe(true)
  expect(isApiKey(patient as Patient)).toBe(false)
})

test('the scope is the one the FHIR guide gives', () => {
  expect(apiKeyScope('gemini')).toBe(
    'user/Basic.rs?code=urn:tiro-health:basic-kind|api-key&provider=gemini',
  )
})
