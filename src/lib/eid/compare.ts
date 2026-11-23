import type { Patient } from 'fhir/r4'
import { formatDate } from '@/lib/fhir/format'
import type { EidCard } from '@/lib/eid/types'

// Compares what the card says with the patient in the EHR, field by field.

export const SSIN_SYSTEM =
  'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin'

export type Outcome =
  'match' | 'mismatch' | 'missing-in-ehr' | 'missing-on-card'

export interface FieldComparison {
  field:
    'national-number' | 'family-name' | 'given-names' | 'birth-date' | 'gender'
  label: string
  card: string
  ehr: string
  outcome: Outcome
}

/** Letters only, without accents or case: "Van  den-Berg" and "van den berg" are the same. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
}

const digits = (value: string) => value.replace(/\D/g, '')

/** "58041200212" as "58.04.12-002.12". */
export function formatNationalNumber(value: string): string {
  const d = digits(value)
  return d.length === 11
    ? `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}-${d.slice(6, 9)}.${d.slice(9)}`
    : value
}

function outcome(card: string, ehr: string, same: boolean): Outcome {
  if (!ehr) return 'missing-in-ehr'
  if (!card) return 'missing-on-card'
  return same ? 'match' : 'mismatch'
}

/**
 * The card holds at most two given names, the EHR often one: given names match when the
 * shorter list is the start of the longer one.
 */
function givenNamesMatch(card: string, ehr: string): boolean {
  const a = normaliseName(card).split(' ').filter(Boolean)
  const b = normaliseName(ehr).split(' ').filter(Boolean)
  const shared = Math.min(a.length, b.length)
  return (
    shared > 0 && a.slice(0, shared).join(' ') === b.slice(0, shared).join(' ')
  )
}

const GENDER_TEXT: Record<string, string> = { male: 'Male', female: 'Female' }

export function compareWithPatient(
  card: EidCard,
  patient: Patient,
): FieldComparison[] {
  const name =
    patient.name?.find((n) => n.use === 'official') ?? patient.name?.[0]
  const ssin = digits(
    patient.identifier?.find((i) => i.system === SSIN_SYSTEM)?.value ?? '',
  )
  const family = name?.family ?? ''
  const given = (name?.given ?? []).join(' ')
  const ehrGender = patient.gender ?? ''
  const cardGender = card.gender ?? ''

  return [
    {
      field: 'national-number',
      label: 'National number',
      card: formatNationalNumber(card.nationalNumber),
      ehr: ssin ? formatNationalNumber(ssin) : '',
      outcome: outcome(card.nationalNumber, ssin, card.nationalNumber === ssin),
    },
    {
      field: 'family-name',
      label: 'Family name',
      card: card.surname,
      ehr: family,
      outcome: outcome(
        card.surname,
        family,
        normaliseName(card.surname) === normaliseName(family),
      ),
    },
    {
      field: 'given-names',
      label: 'Given names',
      card: card.firstNames,
      ehr: given,
      outcome: outcome(
        card.firstNames,
        given,
        givenNamesMatch(card.firstNames, given),
      ),
    },
    {
      field: 'birth-date',
      label: 'Birth date',
      card: card.birthDate ? formatDate(card.birthDate) : card.birthDateText,
      ehr: formatDate(patient.birthDate),
      outcome: outcome(
        card.birthDateText,
        patient.birthDate ?? '',
        card.birthDate !== null && card.birthDate === patient.birthDate,
      ),
    },
    {
      field: 'gender',
      label: 'Gender',
      card: GENDER_TEXT[cardGender] ?? card.genderCode,
      ehr: GENDER_TEXT[ehrGender] ?? ehrGender,
      outcome: outcome(card.genderCode, ehrGender, cardGender === ehrGender),
    },
  ]
}
