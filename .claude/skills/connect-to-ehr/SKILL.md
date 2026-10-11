---
name: connect-to-ehr
description: Build features that read or write the patient's data in the Tiro EHR (patient details, encounters, documents) or save a clinician's settings. Use when the clinician's tool needs anything from the patient's record, mentions the EHR, the chart, the patient, encounters, consultations, visits, letters or documents, or asks to open the app from the EHR or test it with the local EHR.
---

# Connect to the EHR

This app is a SMART on FHIR app of the Tiro EHR. A clinician opens it from a patient's
**Apps** tab; the app then knows which patient, and can read and write that patient's record
within the permissions the clinic approved. Everything below is already built; use it, do not
rebuild it.

## How the launch works (for you, not for the clinician)

The EHR opens `/smart/launch?iss=<clinic FHIR base>&launch=…`. The app's server checks the base
against `SMART_ISS`, sends the clinician through the EHR's sign-in (PKCE, private_key_jwt with the
app's key), and keeps the sign-in in an encrypted cookie. The browser asks the server for a
short-lived access token (`getEhrConnection`) and calls the EHR's FHIR API **directly** with it.
Tokens live 5 minutes and are renewed automatically, one renewal at a time (the EHR ends the
sign-in when an old refresh token is reused). Patient data never touches the app's server.

## What the app can read and write

Only the launched patient's record. The EHR serves FHIR R4 at the clinic's base:

| Resource            | Interactions                         | Search parameters (exact match only)      |
| ------------------- | ------------------------------------ | ----------------------------------------- |
| `Patient`           | read, search                         | `gender`, `family`, `given`, `identifier` |
| `Encounter`         | read, search, create, update, delete | `status`, `class`                         |
| `DocumentReference` | read, search, create                 | `patient`, `subject`, `identifier`        |

- Any other search parameter, including `Encounter?patient=`, `_sort`, `date`, is a **400**.
  Searches are already limited to the launched patient; sort and filter dates in the browser.
- `_count` sets the page size; follow the `next` links (`search()` does).
- The Belgian INSZ is `Patient.identifier` with system
  `https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin`.
- Reading another patient answers 404. Missing permission answers 403.
- Nothing else is served: no Observation, Condition, MedicationRequest, Appointment. If the
  clinician needs one, say plainly that the EHR does not share it with apps yet; do not fake it.

Writing rules the EHR enforces:

- **Encounter update** needs `If-Match: W/"<meta.versionId>"` from the version you read; without
  it the EHR answers 428, with a stale one 412 (someone changed it: read again, show it). `subject`
  cannot change. `period.start` is a date (`YYYY-MM-DD`). `arrived`, `triaged` and `onleave` are
  refused as statuses. Identifiers are not written. Unknown elements are refused with
  422 naming them; send back what you read, changed, not extra fields.
- **Encounter delete** is refused (409) when the clinic documented anything on it.
- **DocumentReference create**: use `createDocumentReference()`. PDF, JPEG, PNG, TIFF, DOCX or
  XLSX, up to 10 MiB. `type` is a clinic document kind (`letter`, `referral`, `lab`, `imaging`,
  `other`, …; `encounter_note` and `quote` are locked). `date` and `context` are refused.

## Permissions (scopes)

What the app asks for is `ehr.scopes` in `src/app.config.ts`. Default:
`patient/Patient.rs patient/Encounter.rs offline_access`. Letters: `c` create, `r` read,
`u` update, `d` delete, `s` search. Add only what the feature needs, e.g.
`patient/DocumentReference.c` to file a letter, `patient/Encounter.u` to update an encounter.
The EHR grants at most what Tiro registered for the app and the clinic approved; tell the
clinician, in one sentence, that a new kind of access must also be approved by Tiro before it
works in the live EHR. Check with `client.can('DocumentReference', 'c')` and hide what the app
may not do.

## The code to use

```tsx
import { useSmart } from '@/hooks/use-smart'
import { useEhrData, useEncounters, usePatient } from '@/hooks/use-fhir'
import { createDocumentReference, formatName, search } from '@/lib/fhir'
import { formatDate } from '@/lib/format'
import type { EhrClient } from '@/lib/smart/client'
import type { Encounter } from 'fhir/r4' // FHIR types: always from fhir/r4, never hand-written
```

- `useSmart()`: `{ status: 'loading' | 'not-configured' | 'not-launched' | 'ended' }` or
  `{ status: 'launched', client }`. `client.patientId`, `client.fhirBase`, `client.can()`,
  `client.json<T>(path, init)` and `client.fetch(path, init)` add the token and renew it.
- `usePatient()`, `useEncounters({ status? })`: `{ status: 'loading' | 'unavailable' | 'error'
| 'ready', data }`. Encounters come most recent first. Handle every status: `unavailable`
  means the app was not opened from a chart.
- Other reads: `useEhrData(load)` with a stable `load` (module-level or `useCallback`), e.g.
  `const letters = (client: EhrClient) => search(client, 'DocumentReference', {})`.
- Writes go in event handlers: `await client.json('Encounter/' + id, { method: 'PUT', headers:
{ 'Content-Type': 'application/fhir+json', 'If-Match': `W/"${e.meta?.versionId}"` }, body:
JSON.stringify(e) })`. Show the EHR's refusal (`EhrError.message`) to the clinician.
- The home page (`src/pages/home.tsx`, `components/patient-banner.tsx`,
  `components/encounter-list.tsx`) is the worked example: reuse `PatientBanner` on any page
  about the patient, and copy the list's loading, error and empty states.
- A clinician's own settings (how many rows, a default, a preference): `useAppState(key,
initial, { parse })`. It is saved in the EHR for that clinician once the EHR offers SMART App
  State, on the device until then. Never put patient data in it.

## Patient-data rules

- Patient data stays between the browser and the EHR. Never add a server function, API route
  or log line that receives, stores or relays it. Never send it to another service.
- Do not keep patient data in `localStorage`, IndexedDB, App State, URLs or `console.log`.
  Read it again from the EHR when it is needed.
- What the app writes becomes part of the patient's record, under "this app on behalf of the
  clinician". Before building a write, confirm with the clinician in one sentence what will be
  written, and show a clear confirmation in the app after it is saved.
- Show the patient's name on any page that shows or changes their data, so the clinician can
  see whose record it is.

## Tests

- **Unit tests** run against the fake EHR, which follows the real EHR's rules (400 on unknown
  search parameters, scopes, paging, document rules):

  ```tsx
  const settings = await testSettings()
  const ehr = fakeEhr(settings) // { openid: true, appState: true } to test App State
  ehr.add(
    {
      resourceType: 'Patient',
      id: 'p1',
      name: [{ family: 'Peeters' }],
    } /* encounters
    with subject: { reference: 'Patient/p1' } */,
  )
  const { connect } = await launchInFakeEhr(
    ehr,
    { ...settings, scopes: [/* if not default */] },
    'p1',
  )
  render(
    <SmartProvider connect={connect} fetch={ehr.fetch}>
      <MyPage />
    </SmartProvider>,
  )
  ```

  Imports: `fakeEhr`, `launchInFakeEhr`, `testSettings` from `@/lib/smart/fake-ehr`. See
  `src/pages/home.test.tsx` and `src/lib/fhir.test.ts`.

- **End-to-end** against the local EHR (`e2e/`, run with `pnpm test:e2e`): every feature that
  reads or writes the record gets one. Use the fixture, which signs a throwaway clinician in
  with a second factor and opens the app from a synthetic patient's chart:

  ```ts
  import { expect, test } from './support/ehr-test'

  test('shows the last three encounters', async ({
    openFromChart,
    chartPatient,
  }) => {
    const app = await openFromChart() // the app's tab, on its home page
    await app.goto('/my-page') // if the feature is on another page
    await expect(app.getByText(chartPatient.family)).toBeVisible()
  })
  ```

  `chartPatient` has `id`, `given`, `family`, `birthDate`, `gender`, `encounters` (count) and
  `latestEncounter` (`YYYY-MM-DD`). For other checks, read the EHR's database the way
  `e2e/support/local-ehr.ts` does. The tests skip with the reason when the stack is not running;
  a skipped test is not a passed one, so say so if it happened.

## Running it against the local EHR

The local Tiro EHR stack runs from the EHR repository (`scripts/local-stack.sh`): the EHR at
http://localhost:3000, its FHIR API at http://localhost:8090, clinics `tonnard-verpaele`,
`dermato`, `leiedal`, `plastische` with synthetic patients. It registers this app as
`dev-smart-app` (launch http://localhost:3001/smart/launch, redirect
http://localhost:3001/smart/callback) and approves it in every clinic.

1. `cp .env.example .env` if `.env` is missing, and put the dev client's private key in
   `SMART_PRIVATE_JWK` (one line of JSON from the EHR repo's
   `.local-stack/smart-dev-client/private.jwk.json`) and a random `SESSION_SECRET`
   (`openssl rand -hex 32`). Never commit `.env`.
2. `pnpm dev` serves the app on http://localhost:3001 (port 3000 is the EHR's).
3. To try it by hand: sign in to the EHR at http://localhost:3000 as staff with a second factor,
   open a patient, **Apps**, **Openen Dev SMART app**. It opens in a new tab.
4. `pnpm test:e2e` does the same automatically.

Without the stack, the app still runs and shows "Not opened from a patient's chart"; unit tests
with the fake EHR still cover the feature.

## Live

On tirohealth.app the server needs `SMART_CLIENT_ID`, `SMART_PRIVATE_JWK`, `SMART_ISS`, `APP_URL`
and `SESSION_SECRET`; Tiro sets them when it registers the app with the EHR. The EHR fetches the
app's public key from `https://<app>.tirohealth.app/.well-known/jwks.json`.
