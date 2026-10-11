import { appConfig } from '@/app.config'
import { EncounterList } from '@/components/encounter-list'
import { PatientBanner } from '@/components/patient-banner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSmart } from '@/hooks/use-smart'

/**
 * The example page: the patient the app was opened for and their encounters. Ask Claude Code to
 * replace it with your first tool.
 */
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

      <PatientBanner />
      <EncounterList />
    </div>
  )
}
