import type { Encounter, Patient } from 'fhir/r4'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "Jeanne Voorbeeld": the official name if there is one, otherwise the first. */
export function patientName(patient: Patient): string {
  const name =
    patient.name?.find((n) => n.use === 'official') ?? patient.name?.[0]
  if (!name) return 'Unnamed patient'
  const parts = [...(name.given ?? []), name.family].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : (name.text ?? 'Unnamed patient')
}

/**
 * "3 Mar 2026" from a FHIR date or dateTime. Uses the day as written in the record, so the
 * server and the browser always show the same text whatever their time zone.
 */
export function formatDate(value: string | undefined): string {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value ?? '')
  if (!match) return ''
  const [, year, month, day] = match
  if (!month) return year
  const named = `${MONTHS[Number(month) - 1]} ${year}`
  return day ? `${Number(day)} ${named}` : named
}

/** "Follow-up consultation", falling back to the kind of contact ("ambulatory"). */
export function encounterTitle(encounter: Encounter): string {
  const type = encounter.type?.[0]
  return (
    type?.text ??
    type?.coding?.[0]?.display ??
    encounter.class?.display ??
    encounter.class?.code ??
    'Encounter'
  )
}
