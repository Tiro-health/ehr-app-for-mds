import { appConfig } from '@/app.config'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAppState } from '@/hooks/use-app-state'
import type { AppStateStatus } from '@/hooks/use-app-state'
import { useEncounters, usePatient } from '@/hooks/ehr'
import { encounterTitle, formatDate, patientName } from '@/lib/fhir/format'

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {appConfig.name}
        </h1>
        <p className="mt-2 text-muted-foreground">{appConfig.tagline}</p>
      </div>

      <PatientCard />

      <ClickCounter />
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

/** The example: a count saved for the signed-in clinician, in the EHR when opened from it. */
function ClickCounter() {
  const [clicks, setClicks, saved] = useAppState('click-count', 0, {
    parse: (v) =>
      typeof v === 'number' && Number.isInteger(v) ? v : undefined,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your app is running</CardTitle>
        <CardDescription>
          This is the example page. Ask Claude Code to replace it with your
          first tool.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Button
          disabled={saved === 'loading'}
          onClick={() => setClicks((n) => n + 1)}
        >
          Click me
        </Button>
        <span className="text-sm text-muted-foreground">
          Clicked {clicks} {clicks === 1 ? 'time' : 'times'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {savedLabel[saved]}
        </span>
      </CardContent>
    </Card>
  )
}

const savedLabel: Record<AppStateStatus, string> = {
  loading: '',
  ehr: 'Saved in the EHR',
  device: 'Saved on this device',
  conflict: 'Updated elsewhere: showing the latest',
  error: 'Could not save',
}
