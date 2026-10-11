import type { Encounter } from 'fhir/r4'
import {
  ageInYears,
  createDocumentReference,
  formatName,
  readPatient,
  search,
  searchEncounters,
} from './fhir'
import { formatDate } from './format'
import { fakeEhr, launchedClient, testSettings } from './smart/fake-ehr'

function encounter(id: string, start: string, patient = 'p1'): Encounter {
  return {
    resourceType: 'Encounter',
    id,
    status: 'finished',
    class: { code: 'AMB' },
    subject: { reference: `Patient/${patient}` },
    period: { start },
  }
}

async function setup(scopes?: string[]) {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  ehr.add(
    {
      resourceType: 'Patient',
      id: 'p1',
      name: [{ family: 'Reyskens', given: ['Joachim'] }],
      gender: 'male',
      birthDate: '1980-04-06',
    },
    encounter('e1', '2021-04-02'),
    encounter('e2', '2023-03-17'),
    encounter('e3', '2022-04-01'),
    { ...encounter('e4', '2024-01-10'), status: 'planned' },
    encounter('other', '2025-01-01', 'p2'),
  )
  const client = await launchedClient(
    ehr,
    scopes ? { ...settings, scopes } : settings,
    'p1',
  )
  return { ehr, client }
}

test('reads the launched patient', async () => {
  const { client } = await setup()
  const patient = await readPatient(client)
  expect(formatName(patient.name)).toBe('Joachim Reyskens')
  expect(patient.birthDate).toBe('1980-04-06')
})

test('lists only this patient’s encounters, most recent first', async () => {
  const { client } = await setup()
  const encounters = await searchEncounters(client)
  expect(encounters.map((e) => e.id)).toEqual(['e4', 'e2', 'e3', 'e1'])
})

test('narrows encounters with the parameters the EHR serves', async () => {
  const { client } = await setup()
  const planned = await searchEncounters(client, { status: 'planned' })
  expect(planned.map((e) => e.id)).toEqual(['e4'])
})

test('follows the EHR’s next-page links', async () => {
  const { ehr, client } = await setup()
  const encounters = await search(client, 'Encounter', {}, { pageSize: 2 })
  expect(encounters).toHaveLength(4)
  const reads = ehr.fhirRequests.filter((u) => u.includes('/Encounter'))
  expect(reads).toHaveLength(2)
  expect(reads[1]).toContain('_offset=2')
})

test('stops at max results', async () => {
  const { client } = await setup()
  const encounters = await search(
    client,
    'Encounter',
    {},
    { max: 3, pageSize: 2 },
  )
  expect(encounters).toHaveLength(3)
})

test('the EHR refuses a search parameter it does not serve', async () => {
  const { client } = await setup()
  // Not allowed by the types either: this is what the type check protects against.
  await expect(client.json('Encounter?patient=p1')).rejects.toThrow(
    '400: unsupported search parameter',
  )
})

test('files a document in the patient’s record', async () => {
  const { ehr, client } = await setup([
    'patient/Patient.rs',
    'patient/DocumentReference.crs',
  ])
  const pdf = new TextEncoder().encode('%PDF-1.4 test')
  const created = await createDocumentReference(client, {
    kind: 'letter',
    title: 'brief.pdf',
    contentType: 'application/pdf',
    data: new Blob([pdf]),
    description: 'Letter to the GP',
    created: '2026-10-11',
  })
  expect(created.id).toBeTruthy()
  const stored = ehr.resources.get(`DocumentReference/${created.id}`)!
  expect(stored).toMatchObject({
    status: 'current',
    subject: { reference: 'Patient/p1' },
    type: { coding: [{ system: 'urn:tv:document-kind', code: 'letter' }] },
    description: 'Letter to the GP',
    content: [
      {
        attachment: {
          contentType: 'application/pdf',
          title: 'brief.pdf',
          creation: '2026-10-11',
          data: btoa('%PDF-1.4 test'),
        },
      },
    ],
  })
  expect(stored).not.toHaveProperty('date')
  expect(stored).not.toHaveProperty('context')
})

test('filing a document without the scope is refused by the EHR', async () => {
  const { client } = await setup()
  await expect(
    createDocumentReference(client, {
      kind: 'letter',
      title: 'brief.pdf',
      contentType: 'application/pdf',
      data: new Uint8Array([1]),
    }),
  ).rejects.toThrow('The EHR answered 403')
})

test('refuses files the EHR would not take, before sending them', async () => {
  const { client } = await setup(['patient/DocumentReference.c'])
  await expect(
    createDocumentReference(client, {
      kind: 'letter',
      title: 'big.pdf',
      contentType: 'application/pdf',
      data: new Uint8Array(10 * 1024 * 1024 + 1),
    }),
  ).rejects.toThrow('10 MiB')
  await expect(
    createDocumentReference(client, {
      kind: 'letter',
      title: 'note.txt',
      // @ts-expect-error not a type the EHR stores
      contentType: 'text/plain',
      data: new Uint8Array([1]),
    }),
  ).rejects.toThrow('does not store text/plain')
})

test('names, ages and dates read the way clinicians write them', () => {
  expect(formatName([{ given: ['Marie', 'Anne'], family: 'Fillieux' }])).toBe(
    'Marie Anne Fillieux',
  )
  expect(
    formatName([
      { use: 'maiden', family: 'Old' },
      { use: 'official', text: 'Dr. Jan Peeters' },
    ]),
  ).toBe('Dr. Jan Peeters')
  expect(formatName(undefined)).toBe('')
  expect(ageInYears('1980-04-06', new Date(2026, 3, 5))).toBe(45)
  expect(ageInYears('1980-04-06', new Date(2026, 3, 6))).toBe(46)
  expect(formatDate('2023-03-17')).toBe('17 Mar 2023')
  expect(formatDate('2023-03')).toBe('Mar 2023')
  expect(formatDate('2023-03-17T10:00:00+01:00')).toBe('17 Mar 2023')
})
