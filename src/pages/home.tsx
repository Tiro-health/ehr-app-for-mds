import { useEffect, useState } from 'react'
import { appConfig } from '@/app.config'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppState, type AppStateStatus } from '@/hooks/use-app-state'
import { useSmart } from '@/hooks/use-smart'
import type { EhrClient } from '@/lib/smart/client'

export function HomePage() {
  const smart = useSmart()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {appConfig.name}
        </h1>
        <p className="mt-2 text-muted-foreground">{appConfig.tagline}</p>
      </div>

      {smart.status === 'loading' && <Skeleton className="h-24 w-full" />}
      {smart.status === 'launched' && <PatientCard client={smart.client} />}
      {smart.status === 'ended' && (
        <Alert>
          <AlertTitle>The connection to the EHR ended</AlertTitle>
          <AlertDescription>
            Open the app again from the patient’s chart in the EHR.
          </AlertDescription>
        </Alert>
      )}
      {(smart.status === 'not-launched' ||
        smart.status === 'not-configured') && (
        <Alert>
          <AlertTitle>Not opened from a patient’s chart</AlertTitle>
          <AlertDescription>
            {smart.status === 'not-launched' && smart.error
              ? smart.error
              : 'Open this app from the Apps tab of a patient in the EHR to see their data.'}
          </AlertDescription>
        </Alert>
      )}

      <ClickCounter />
    </div>
  )
}

type Patient = {
  name?: { text?: string; given?: string[]; family?: string }[]
}

function PatientCard({ client }: { client: EhrClient }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!client.patientId) return
    client
      .json<Patient>(`Patient/${encodeURIComponent(client.patientId)}`)
      .then(setPatient)
      .catch((e: unknown) => setError(String(e)))
  }, [client])

  const name = patient?.name?.[0]
  return (
    <Card>
      <CardHeader>
        <CardDescription>Opened from the EHR for</CardDescription>
        <CardTitle data-testid="patient-name">
          {error ??
            (name
              ? (name.text ??
                [...(name.given ?? []), name.family].filter(Boolean).join(' '))
              : 'Loading…')}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

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
        <Button onClick={() => setClicks((n) => n + 1)}>Click me</Button>
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
