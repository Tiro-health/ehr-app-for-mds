import type { Patient } from 'fhir/r4'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePatient } from '@/hooks/use-fhir'
import { ageInYears, formatName } from '@/lib/fhir'
import { formatDate } from '@/lib/format'

/** The patient the app was opened for: name, birth date and age, gender. */
export function PatientBanner() {
  const patient = usePatient()
  if (patient.status === 'unavailable') return null
  if (patient.status === 'loading') return <Skeleton className="h-20 w-full" />
  if (patient.status === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not read the patient</CardTitle>
          <CardDescription>{patient.error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card aria-label="Patient">
      <CardHeader>
        <CardTitle className="text-xl" data-testid="patient-name">
          {formatName(patient.data.name) || 'Unnamed patient'}
        </CardTitle>
        <CardDescription data-testid="patient-details">
          {details(patient.data)}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function details(patient: Patient) {
  const parts: string[] = []
  if (patient.birthDate) {
    parts.push(
      `Born ${formatDate(patient.birthDate)} (${ageInYears(patient.birthDate)} years)`,
    )
  }
  if (patient.gender) parts.push(genderLabel[patient.gender])
  return parts.join(' · ') || 'No birth date or gender recorded'
}

const genderLabel: Record<NonNullable<Patient['gender']>, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  unknown: 'Unknown',
}
