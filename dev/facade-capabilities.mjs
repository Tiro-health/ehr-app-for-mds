// What the Tiro EHR's FHIR API (R4) serves, as its CapabilityStatement said on 2026-11-14
// (`fhir.request('GET', 'metadata')` against the local EHR). The pretend sidecar answers by
// this table so the local preview refuses what the real EHR refuses. The app itself never
// reads it: the `fhir` helper has no list of resource types.
//
// interactions: r read, s search, c create, u update, d delete.

/** @type {Record<string, { interactions: string, params: string[], deleteNeedsVersion?: boolean }>} */
export const SERVED = {
  Basic: {
    interactions: 'rscud',
    params: ['_id', 'code', 'subject'],
    deleteNeedsVersion: true,
  },
  Claim: {
    interactions: 'rsc',
    params: ['_id', '_lastUpdated', 'encounter', 'patient'],
  },
  ClaimResponse: {
    interactions: 'rsc',
    params: ['_id', 'identifier', 'patient', 'request'],
  },
  Coverage: { interactions: 'rsc', params: ['_id', 'beneficiary', 'patient'] },
  DocumentReference: {
    interactions: 'rsc',
    params: ['_id', 'identifier', 'patient', 'subject'],
  },
  Encounter: {
    interactions: 'rscud',
    params: [
      '_id',
      'class',
      'date',
      'date-start',
      'patient',
      'status',
      'subject',
    ],
  },
  MedicationRequest: {
    interactions: 'rscu',
    params: ['_id', 'encounter', 'identifier', 'patient', 'status', 'subject'],
  },
  Patient: {
    interactions: 'rs',
    params: ['_id', 'family', 'gender', 'given', 'identifier'],
  },
  Practitioner: {
    interactions: 'rs',
    params: ['_id', 'family', 'given', 'identifier'],
  },
  Task: {
    interactions: 'rscu',
    params: ['_id', 'code', 'focus', 'identifier', 'patient', 'status'],
  },
}

/** Accepted on every search without filtering anything in the pretend EHR. */
export const RESULT_PARAMS = [
  '_count',
  '_offset',
  '_sort',
  '_summary',
  '_include',
  '_revinclude',
]
