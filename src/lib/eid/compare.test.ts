import type { Patient } from 'fhir/r4'
import matching from '../../../fixtures/eid/card-matching-patient-1.json'
import specimen from '../../../fixtures/eid/card-beidconnect-specimen.json'
import patient1 from '../../../fixtures/r4/Patient-patient-1.json'
import {
  compareWithPatient,
  formatNationalNumber,
  normaliseName,
} from './compare'
import { parseCard } from './tlv'

const cardOf = (answer: typeof specimen) =>
  parseCard(new Uint8Array(Buffer.from(answer.Readers[0].id, 'base64')))
const patient = patient1 as Patient
const outcomes = (rows: ReturnType<typeof compareWithPatient>) =>
  Object.fromEntries(rows.map((row) => [row.field, row.outcome]))

test('the invented card of patient-1 matches on every field', () => {
  const rows = compareWithPatient(cardOf(matching), patient)
  expect(outcomes(rows)).toEqual({
    'national-number': 'match',
    'family-name': 'match',
    'given-names': 'match',
    'birth-date': 'match',
    gender: 'match',
  })
  expect(rows[0]).toMatchObject({
    card: '58.04.12-002.12',
    ehr: '58.04.12-002.12',
  })
  expect(rows[3]).toMatchObject({ card: '12 Apr 1958', ehr: '12 Apr 1958' })
})

test("someone else's card differs, except for the gender", () => {
  expect(outcomes(compareWithPatient(cardOf(specimen), patient))).toEqual({
    'national-number': 'mismatch',
    'family-name': 'mismatch',
    'given-names': 'mismatch',
    'birth-date': 'mismatch',
    gender: 'match',
  })
})

test('a patient without a national number in the EHR is "missing", not "differs"', () => {
  const without: Patient = {
    ...patient,
    identifier: [{ system: 'urn:example:synthetic', value: '58041200212' }],
    gender: undefined,
    birthDate: undefined,
  }
  expect(outcomes(compareWithPatient(cardOf(matching), without))).toMatchObject(
    {
      'national-number': 'missing-in-ehr',
      'birth-date': 'missing-in-ehr',
      gender: 'missing-in-ehr',
    },
  )
})

test('the national number is compared on its digits', () => {
  const dotted: Patient = {
    ...patient,
    identifier: [
      {
        system:
          'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin',
        value: '58.04.12-002.12',
      },
    ],
  }
  expect(compareWithPatient(cardOf(matching), dotted)[0].outcome).toBe('match')
})

test('names are compared without capitals, accents and punctuation', () => {
  const card = {
    ...cardOf(matching),
    surname: 'VAN DEN-BERGÉ',
    firstNames: 'Zoë Marie',
  }
  const named = (family: string, given: string[]): Patient => ({
    ...patient,
    name: [{ family, given }],
  })
  expect(
    outcomes(compareWithPatient(card, named('van den Berge', ['Zoe']))),
  ).toMatchObject({ 'family-name': 'match', 'given-names': 'match' })
  expect(
    outcomes(compareWithPatient(card, named('Vandenberge', ['Marie']))),
  ).toMatchObject({ 'family-name': 'mismatch', 'given-names': 'mismatch' })
  // The EHR holds more given names than the card can.
  expect(
    compareWithPatient(card, named('x', ['Zoë', 'Marie', 'Louise']))[2].outcome,
  ).toBe('match')
})

test('a birth date the card does not give in full differs', () => {
  const card = { ...cardOf(matching), birthDateText: '1958', birthDate: null }
  expect(compareWithPatient(card, patient)[3]).toMatchObject({
    card: '1958',
    outcome: 'mismatch',
  })
})

test('helpers', () => {
  expect(normaliseName('  D’Hondt-Peeters ')).toBe('d hondt peeters')
  expect(formatNationalNumber('98082100029')).toBe('98.08.21-000.29')
  expect(formatNationalNumber('123')).toBe('123')
})
