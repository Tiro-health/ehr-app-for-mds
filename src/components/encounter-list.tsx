import type { Encounter } from 'fhir/r4'
import { Badge } from '@/components/ui/badge'
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
import { useEncounters } from '@/hooks/use-fhir'
import { formatDate } from '@/lib/format'

const CHOICES = [5, 10, 0] as const
type Shown = (typeof CHOICES)[number]

/**
 * The patient's encounters, most recent first. How many to show is the clinician's own setting,
 * saved with App State: in the EHR when it offers that, otherwise on this device.
 */
export function EncounterList() {
  const encounters = useEncounters()
  const [shown, setShown, saved] = useAppState<Shown>('encounters-shown', 5, {
    parse: (v) => CHOICES.find((c) => c === v),
  })
  if (encounters.status === 'unavailable') return null

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Encounters</CardTitle>
          <CardDescription>
            {encounters.status === 'ready'
              ? `${encounters.data.length} in the EHR, most recent first`
              : 'Reading from the EHR…'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show</span>
          {CHOICES.map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant={shown === choice ? 'default' : 'outline'}
              aria-pressed={shown === choice}
              onClick={() => setShown(choice)}
            >
              {choice === 0 ? 'All' : choice}
            </Button>
          ))}
          <span
            className="w-36 text-right text-xs text-muted-foreground"
            data-testid="setting-saved"
          >
            {savedLabel[saved]}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {encounters.status === 'loading' && (
          <Skeleton className="h-32 w-full" />
        )}
        {encounters.status === 'error' && (
          <p className="text-sm text-destructive">{encounters.error}</p>
        )}
        {encounters.status === 'ready' && encounters.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No encounters yet.</p>
        )}
        {encounters.status === 'ready' && encounters.data.length > 0 && (
          <ul className="divide-y" aria-label="Encounters">
            {(shown ? encounters.data.slice(0, shown) : encounters.data).map(
              (encounter) => (
                <EncounterRow key={encounter.id} encounter={encounter} />
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function EncounterRow({ encounter }: { encounter: Encounter }) {
  const reason = encounter.reasonCode
    ?.map((r) => r.text ?? r.coding?.[0]?.display)
    .filter(Boolean)
    .join(', ')
  const kind =
    encounter.type?.[0]?.text ?? encounter.type?.[0]?.coding?.[0]?.display
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
      <span className="w-28 shrink-0 text-sm font-medium tabular-nums">
        {encounter.period?.start
          ? formatDate(encounter.period.start)
          : 'No date'}
      </span>
      <span className="order-last w-full text-sm sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
        {reason || kind || 'No reason recorded'}
      </span>
      <Badge variant="outline">{classLabel(encounter.class?.code)}</Badge>
      {encounter.status !== 'finished' && (
        <Badge variant="secondary">{statusLabel[encounter.status]}</Badge>
      )}
    </li>
  )
}

function classLabel(code: string | undefined) {
  const labels: Record<string, string> = {
    AMB: 'Outpatient',
    IMP: 'Inpatient',
    EMER: 'Emergency',
    VR: 'Virtual',
    HH: 'Home visit',
    SS: 'Day care',
  }
  return (code && labels[code]) || code || 'Encounter'
}

const statusLabel: Record<Encounter['status'], string> = {
  planned: 'Planned',
  arrived: 'Arrived',
  triaged: 'Triaged',
  'in-progress': 'In progress',
  onleave: 'On leave',
  finished: 'Finished',
  cancelled: 'Cancelled',
  'entered-in-error': 'Entered in error',
  unknown: 'Unknown',
}

const savedLabel: Record<AppStateStatus, string> = {
  loading: '',
  ehr: 'Saved in the EHR for you',
  device: 'Saved on this device',
  conflict: 'Changed elsewhere: showing the latest',
  error: 'Could not save',
}
