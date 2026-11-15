// Invented data for the pretend EHR used in local preview and tests.
// Nothing here describes a real person. Never put real patient data in this file.

export const DOCUMENT_KIND_SYSTEM = 'urn:tiro-health:document-kind'

/** @type {import('fhir/r4').Practitioner} */
export const practitioner = {
  resourceType: 'Practitioner',
  id: 'synthetic-practitioner-1',
  name: [{ family: 'Proef', given: ['Dokter'] }],
}

/** @type {import('fhir/r4').Patient[]} */
export const patients = [
  {
    resourceType: 'Patient',
    id: 'synthetic-patient-1',
    identifier: [{ system: 'urn:example:synthetic', value: 'SYN-0001' }],
    name: [{ use: 'official', family: 'Voorbeeld', given: ['Jeanne'] }],
    gender: 'female',
    birthDate: '1958-04-12',
  },
  {
    resourceType: 'Patient',
    id: 'synthetic-patient-2',
    identifier: [{ system: 'urn:example:synthetic', value: 'SYN-0002' }],
    name: [{ use: 'official', family: 'Specimen', given: ['Karel'] }],
    gender: 'male',
    birthDate: '1971-11-03',
  },
]

const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode'

/** @type {import('fhir/r4').Encounter[]} */
export const encounters = [
  {
    resourceType: 'Encounter',
    id: 'synthetic-encounter-1',
    status: 'finished',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    type: [{ text: 'Follow-up consultation' }],
    subject: { reference: 'Patient/synthetic-patient-1' },
    period: {
      start: '2026-03-03T09:30:00+01:00',
      end: '2026-03-03T10:00:00+01:00',
    },
  },
  {
    resourceType: 'Encounter',
    id: 'synthetic-encounter-2',
    status: 'finished',
    class: { system: ACT_CODE, code: 'IMP', display: 'inpatient encounter' },
    type: [{ text: 'Day admission' }],
    subject: { reference: 'Patient/synthetic-patient-1' },
    period: {
      start: '2026-06-17T08:00:00+02:00',
      end: '2026-06-17T17:15:00+02:00',
    },
  },
  {
    resourceType: 'Encounter',
    id: 'synthetic-encounter-3',
    status: 'in-progress',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    type: [{ text: 'First consultation' }],
    subject: { reference: 'Patient/synthetic-patient-1' },
    period: { start: '2026-11-14T14:00:00+01:00' },
  },
  {
    resourceType: 'Encounter',
    id: 'synthetic-encounter-4',
    status: 'finished',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    type: [{ text: 'Consultation' }],
    subject: { reference: 'Patient/synthetic-patient-2' },
    period: { start: '2026-09-01T11:00:00+02:00' },
  },
]

/**
 * Invented resources of any other type the app reads (for example Observation), so they
 * show up in the local preview. Each one points at its patient with `subject` or `patient`.
 * @type {import('fhir/r4').FhirResource[]}
 */
export const otherResources = []
