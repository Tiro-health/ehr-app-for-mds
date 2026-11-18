import { describe, expect, test } from 'vitest'
import { covers, grants } from '@/lib/fhir/scopes'

describe('grants', () => {
  test('allows the letters of a v2 scope on its own type', () => {
    expect(grants('patient/Encounter.rs', 'Encounter', 'r')).toBe(true)
    expect(grants('patient/Encounter.rs', 'Encounter', 's')).toBe(true)
    expect(grants('patient/Encounter.rs', 'Encounter', 'c')).toBe(false)
    expect(grants('patient/Encounter.rs', 'Patient', 'r')).toBe(false)
  })

  test.each([
    ['patient/*.rs', 'a wildcard type'],
    ['patient/Encounter.read', 'v1 read'],
    ['patient/Encounter.write', 'v1 write'],
    ['patient/Encounter.*', 'v1 wildcard letters'],
    ['patient/Encounter.sr', 'letters out of order'],
    ['patient/Encounter.rs?category=x', 'a filter'],
    ['launch', 'a non-resource scope'],
  ])('allows nothing for %s (%s)', (scope) => {
    expect(grants(scope, 'Encounter', 'r')).toBe(false)
  })
})

describe('covers', () => {
  test('needs every letter granted', () => {
    expect(
      covers(
        ['patient/Encounter.r', 'user/Encounter.s'],
        'patient/Encounter.rs',
      ),
    ).toBe(true)
    expect(covers(['patient/Encounter.r'], 'patient/Encounter.rs')).toBe(false)
  })

  test('rejects a need that is not a v2 scope', () => {
    expect(() => covers([], 'patient/Encounter.read')).toThrow(TypeError)
  })
})
