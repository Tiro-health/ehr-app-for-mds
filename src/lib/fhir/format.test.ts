import { encounterTitle, formatDate, patientName } from './format'

test('patientName prefers the official name', () => {
  expect(
    patientName({
      resourceType: 'Patient',
      name: [
        { use: 'nickname', given: ['Jo'] },
        { use: 'official', family: 'Voorbeeld', given: ['Jeanne', 'M.'] },
      ],
    }),
  ).toBe('Jeanne M. Voorbeeld')
  expect(patientName({ resourceType: 'Patient' })).toBe('Unnamed patient')
})

test('formatDate shows the day as written in the record', () => {
  expect(formatDate('2026-03-03T23:30:00-08:00')).toBe('3 Mar 2026')
  expect(formatDate('1958-04-12')).toBe('12 Apr 1958')
  expect(formatDate('2026-06')).toBe('Jun 2026')
  expect(formatDate('2026')).toBe('2026')
  expect(formatDate(undefined)).toBe('')
})

test('encounterTitle falls back to the kind of contact', () => {
  expect(
    encounterTitle({
      resourceType: 'Encounter',
      status: 'finished',
      class: { code: 'AMB', display: 'ambulatory' },
    }),
  ).toBe('ambulatory')
})
