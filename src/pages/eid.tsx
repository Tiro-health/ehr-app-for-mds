import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  CreditCard,
  ShieldAlert,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { usePatient } from '@/hooks/ehr'
import { eidVerify } from '@/lib/eid.functions'
import { beIdConnectSource, simulatedSource } from '@/lib/eid/card-source'
import type { CardRead, CardSource } from '@/lib/eid/card-source'
import { compareWithPatient } from '@/lib/eid/compare'
import type { FieldComparison, Outcome } from '@/lib/eid/compare'
import type { EidReading } from '@/lib/eid/types'
import { formatDate, patientName } from '@/lib/fhir/format'

// Reads a Belgian eID card through BeIDConnect and compares it with the patient that is open
// in the EHR. A prototype: it shows the comparison and changes nothing in the record.

type Result =
  | { kind: 'read'; reading: EidReading; simulated: boolean; cards: number }
  | { kind: 'not-read'; read: Exclude<CardRead, { status: 'ok' }> }
  | { kind: 'session-ended' }

const REAL_READER = beIdConnectSource()

/** In the local preview only: invented cards, so the page can be tried without a reader. */
async function previewSources(): Promise<CardSource[]> {
  if (!import.meta.env.DEV) return []
  const [matching, specimen] = await Promise.all([
    import('../../fixtures/eid/card-matching-patient-1.json'),
    import('../../fixtures/eid/card-beidconnect-specimen.json'),
  ])
  return [
    simulatedSource(
      'simulated-matching',
      'Simulated card: same person as the test patient',
      matching.default,
    ),
    simulatedSource(
      'simulated-specimen',
      'Simulated card: BeIDConnect specimen (someone else)',
      specimen.default,
    ),
  ]
}

export function EidPage({ sources }: { sources?: CardSource[] }) {
  const { patient, launched, isLoading } = usePatient()
  const [extra, setExtra] = useState<CardSource[]>([])
  useEffect(() => {
    if (sources) return
    let current = true
    void previewSources().then((found) => {
      if (current) setExtra(found)
    })
    return () => {
      current = false
    }
  }, [sources])
  const available = sources ?? [REAL_READER, ...extra]

  const read = useMutation({
    mutationFn: async (source: CardSource): Promise<Result> => {
      const card = await source.read()
      if (card.status !== 'ok') return { kind: 'not-read', read: card }
      const answer = await eidVerify({ data: card.files })
      if (!answer.launched) return { kind: 'session-ended' }
      return {
        kind: 'read',
        reading: answer.data,
        simulated: source.simulated,
        cards: card.cards,
      }
    },
  })
  const result = read.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Check eID card
        </h1>
        <p className="mt-2 text-muted-foreground">
          Reads the eID card in the card reader and compares it with the patient
          that is open in the EHR. Nothing is changed in the record and the card
          data is not kept.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {patient ? patientName(patient) : 'Patient in the EHR'}
          </CardTitle>
          <CardDescription>
            {patient
              ? `Open in the EHR${patient.birthDate ? ` · born ${formatDate(patient.birthDate)}` : ''}`
              : isLoading
                ? 'Loading the patient…'
                : launched
                  ? 'The patient could not be loaded from the EHR.'
                  : 'Your session with the EHR has ended. Start the app again from the EHR.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {available.map((source) => (
            <Button
              key={source.id}
              variant={source.simulated ? 'outline' : 'default'}
              disabled={!patient || read.isPending}
              onClick={() => read.mutate(source)}
            >
              <CreditCard />
              {source.simulated ? source.label : 'Read eID'}
            </Button>
          ))}
          {read.isPending && (
            <span className="text-sm text-muted-foreground" role="status">
              Reading the card…
            </span>
          )}
        </CardContent>
      </Card>

      {read.isError && (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>The card could not be checked</AlertTitle>
          <AlertDescription>
            The card was read, but its data could not be checked. Try again; if
            it keeps happening, the card may be of a kind this prototype does
            not know.
          </AlertDescription>
        </Alert>
      )}

      {!read.isPending && result?.kind === 'session-ended' && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertTitle>Your session has ended</AlertTitle>
          <AlertDescription>
            Start the app again from the patient's Apps tab in the EHR, then
            read the card again.
          </AlertDescription>
        </Alert>
      )}

      {!read.isPending && result?.kind === 'not-read' && (
        <NotRead read={result.read} />
      )}

      {!read.isPending && result?.kind === 'read' && patient && (
        <Reading
          reading={result.reading}
          simulated={result.simulated}
          cards={result.cards}
          comparison={compareWithPatient(result.reading.card, patient)}
        />
      )}
    </div>
  )
}

const NOT_READ: Record<
  Exclude<CardRead['status'], 'ok' | 'error'>,
  { title: string; body: string }
> = {
  'extension-missing': {
    title: 'BeIDConnect is not installed in this browser',
    body: 'Install the BeIDConnect extension for this browser and the BeIDConnect program on this computer (from the Belgian government, BOSA), reload this page and try again.',
  },
  'host-missing': {
    title: 'The BeIDConnect program is not installed on this computer',
    body: 'The browser extension is there, but it could not reach the BeIDConnect program on this computer. Install it, restart the browser and try again.',
  },
  'no-reader': {
    title: 'No card reader found',
    body: 'Connect a card reader to this computer and try again.',
  },
  'no-card': {
    title: 'No eID card in the reader',
    body: 'Put the eID card in the reader, chip first, and try again.',
  },
  busy: {
    title: 'The card reader is busy',
    body: 'Another program is using the card. Wait a moment and try again.',
  },
  timeout: {
    title: 'The card reader did not answer',
    body: 'BeIDConnect did not answer in time. Take the card out, put it back and try again.',
  },
}

function NotRead({ read }: { read: Exclude<CardRead, { status: 'ok' }> }) {
  const text =
    read.status === 'error'
      ? {
          title: 'The card could not be read',
          body: `BeIDConnect reported an error (${read.code}). Take the card out, put it back and try again.`,
        }
      : read.status === 'no-card' && read.unsupported
        ? {
            title: 'This card is not an eID card',
            body: 'The card in the reader is of a kind BeIDConnect does not read. Put a Belgian eID card in the reader and try again.',
          }
        : NOT_READ[read.status]
  return (
    <Alert variant="warning">
      <CircleAlert />
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>{text.body}</AlertDescription>
    </Alert>
  )
}

const OUTCOME: Record<
  Outcome,
  { text: string; tone: 'success' | 'destructive' | 'muted' }
> = {
  match: { text: 'Matches', tone: 'success' },
  mismatch: { text: 'Differs', tone: 'destructive' },
  'missing-in-ehr': { text: 'Not in the EHR', tone: 'muted' },
  'missing-on-card': { text: 'Not on the card', tone: 'muted' },
}

function Reading({
  reading,
  simulated,
  cards,
  comparison,
}: {
  reading: EidReading
  simulated: boolean
  cards: number
  comparison: FieldComparison[]
}) {
  const { card, signatures, validToday } = reading
  const signed = signatures.identity && signatures.address
  const differs = comparison.filter((row) => row.outcome === 'mismatch').length
  const matches = comparison.filter((row) => row.outcome === 'match').length

  return (
    <div className="space-y-6">
      {simulated && (
        <Alert variant="info">
          <CircleHelp />
          <AlertTitle>Simulated card</AlertTitle>
          <AlertDescription>
            This is an invented test card, not a card from a reader.
          </AlertDescription>
        </Alert>
      )}

      {signed ? (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertTitle>
            Signatures valid, origin of the card not checked
          </AlertTitle>
          <AlertDescription>
            The identity and address data carry valid signatures (
            {signatures.algorithm}) of the certificate on the card
            {signatures.signer ? ` ("${signatures.signer}")` : ''}. This
            prototype does not check that this certificate comes from the
            Belgian government, so it does not prove the card is genuine.
            {!signatures.signerValidToday &&
              ' The certificate on the card is outside its validity period.'}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Signatures not valid</AlertTitle>
          <AlertDescription>
            {signatures.identity
              ? 'The signature on the address data is not valid.'
              : 'The signature on the identity data is not valid.'}{' '}
            Do not rely on what this card says.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Card compared with the patient in the EHR</CardTitle>
          <CardDescription>
            {differs > 0
              ? `${differs} of ${comparison.length} fields differ.`
              : `${matches} of ${comparison.length} fields match, none differ.`}
            {cards > 1 && ' More than one card was found; the first was used.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table aria-label="Comparison" className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Field
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  On the card
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  In the EHR
                </th>
                <th scope="col" className="py-2 font-medium">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {comparison.map((row) => (
                <tr key={row.field} data-outcome={row.outcome}>
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {row.label}
                  </th>
                  <td className="py-2 pr-4">{row.card || '—'}</td>
                  <td className="py-2 pr-4">{row.ehr || '—'}</td>
                  <td className="py-2">
                    <Badge tone={OUTCOME[row.outcome].tone} size="sm">
                      {row.outcome === 'match' && <CircleCheck />}
                      {row.outcome === 'mismatch' && <CircleX />}
                      {OUTCOME[row.outcome].text}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Names are compared without capitals and accents. The card holds at
            most two given names: given names match when the first ones agree.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Also on the card</CardTitle>
          <CardDescription>Shown only; not compared.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Address</dt>
            <dd>
              {card.address
                ? `${card.address.street}, ${card.address.zip} ${card.address.municipality}`
                : '—'}
            </dd>
            <dt className="text-muted-foreground">Nationality</dt>
            <dd>{card.nationality || '—'}</dd>
            <dt className="text-muted-foreground">Card number</dt>
            <dd>{card.cardNumber || '—'}</dd>
            <dt className="text-muted-foreground">Card valid</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {card.validFrom && card.validUntil
                ? `${formatDate(card.validFrom)} to ${formatDate(card.validUntil)}`
                : '—'}
              {validToday === false && (
                <Badge tone="warning" size="sm">
                  Not valid today
                </Badge>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
