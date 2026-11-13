import { useState } from 'react'
import { appConfig } from '@/app.config'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useEncounters, usePatient } from '@/hooks/ehr'
import { encounterTitle, formatDate, patientName } from '@/lib/fhir/format'

export function HomePage() {
  const [clicks, setClicks] = useState(0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {appConfig.name}
        </h1>
        <p className="mt-2 text-muted-foreground">{appConfig.tagline}</p>
      </div>

      <PatientCard />

      <Card>
        <CardHeader>
          <CardTitle>Your app is running</CardTitle>
          <CardDescription>
            This is the example page. Ask Claude Code to replace it with your
            first tool.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button onClick={() => setClicks((n) => n + 1)}>Click me</Button>
          <span className="text-sm text-muted-foreground">
            Clicked {clicks} {clicks === 1 ? 'time' : 'times'}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}

/** The patient the app was opened for. Shows nothing when the app was opened directly. */
function PatientCard() {
  const { patient } = usePatient()
  const { encounters, error } = useEncounters()
  if (!patient) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{patientName(patient)}</CardTitle>
        <CardDescription>
          Opened from the EHR
          {patient.birthDate && ` · born ${formatDate(patient.birthDate)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <h2 className="text-sm font-medium">Encounters</h2>
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error.message}</p>
        ) : encounters.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No encounters yet.
          </p>
        ) : (
          <ul aria-label="Encounters" className="mt-2 divide-y text-sm">
            {encounters.map((encounter) => (
              <li key={encounter.id} className="flex justify-between py-2">
                <span>{encounterTitle(encounter)}</span>
                <span className="text-muted-foreground">
                  {formatDate(encounter.period?.start)} · {encounter.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
