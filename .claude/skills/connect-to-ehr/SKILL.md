---
name: connect-to-ehr
description: Build features that use patient data from the Tiro EHR. Use when the clinician's tool needs the patient that is open in the EHR, their encounters or documents, wants to file something in the record, asks to "show the patient's ...", mentions launching the app from the EHR, or when an error mentions a refused scope or smart.json.
---

# Connect to the EHR

The clinician opens a patient in the Tiro EHR and starts this app from the patient's Apps tab.
The hosting platform does that launch: it signs the clinician in, remembers the session, and
gives the app's server a private door to the clinic's FHIR data. **There is no launch,
sign-in or session code in this app, and you never write any.**

What you work with is FHIR: which resources the tool needs, and what it shows or files.

## The rules, before anything else

Patient data passes through this app's server code on its way to the page. These rules have no
exceptions. If a request can only be met by breaking one, do not build it: tell the clinician
in one sentence that this app cannot do that, and that Tiro can advise.

1. **Never log patient data.** No `console.log`, `console.error` or any other output of a
   resource, a name, an id, a birth date, a search value or an EHR error body, on the server
   or in the browser. Do not put patient data in an error message or in a web address.
2. **Never keep patient data on the server between requests.** No variable outside a function,
   no cache, no file, no database, no shared `QueryClient`. A server function fetches, returns,
   and forgets.
3. **Never send patient data to another host.** The server talks to the EHR through the `fhir`
   helper and to nothing else. No request to any other service that carries patient data: no
   AI service, no analytics, no error tracker, no webhook, no e-mail. The same holds for the
   browser.
4. **Never write code that handles a token, a key or an OAuth redirect.** No sign-in page, no
   `Authorization` header, no reading or setting of cookies, no credentials in environment
   variables (none exist). The platform does all of it.
5. **Never define a page or file on `/launch`, `/callback` or `/.well-known/jwks.json`.** They
   belong to the platform. `pnpm check` fails if one appears.
6. **Never put real patient data in the repository.** Test data lives in
   `dev/synthetic-data.mjs` and is invented.

## What the app can read and write

The `fhir` helper works with **any FHIR resource type and any search parameter**: it holds no
list of its own. What exists is decided by the EHR, and what this app may use is decided by
its permissions (see "Permissions"). So before building on a type, find out, do not assume:

- `await fhir.request('GET', 'metadata')` returns the EHR's CapabilityStatement: per resource
  type the interactions (`read`, `search-type`, `create`, `update`, `delete`) and the search
  parameters it accepts. The local preview answers with the same list as the real EHR did when
  `dev/facade-capabilities.mjs` was written. Use it while building, not in a page.
- A type the EHR does not serve answers status 404; an interaction it does not have for a
  type, or an operation such as `$everything`, answers 400. The error message says which.
  Tell the clinician it is not available instead of working around it.

What the Tiro EHR served when this was written (it changes; the CapabilityStatement decides):

| Resource                             | Read, search | Create | Update | Delete | Search parameters                                                    |
| ------------------------------------ | ------------ | ------ | ------ | ------ | -------------------------------------------------------------------- |
| `Patient`                            | yes          | no     | no     | no     | `_id`, `family`, `given`, `gender`, `identifier`                     |
| `Practitioner`                       | yes          | no     | no     | no     | `_id`, `family`, `given`, `identifier`                               |
| `Encounter`                          | yes          | yes    | yes    | yes    | `_id`, `status`, `class`, `date`, `date-start`, `patient`, `subject` |
| `DocumentReference`                  | yes          | yes    | no     | no     | `_id`, `identifier`, `patient`, `subject`                            |
| `MedicationRequest`                  | yes          | yes    | yes    | no     | `_id`, `status`, `identifier`, `encounter`, `patient`, `subject`     |
| `Task`                               | yes          | yes    | yes    | no     | `_id`, `status`, `code`, `identifier`, `focus`, `patient`            |
| `Basic` (app state)                  | yes          | yes    | yes    | yes    | `_id`, `code`, `subject`                                             |
| `Coverage`, `Claim`, `ClaimResponse` | yes          | yes    | no     | no     | see the CapabilityStatement                                          |

- Text and code parameters match exactly, capitals included. There is no "contains" or "starts
  with": filter and sort further in the server function. A parameter the EHR does not know is
  refused (status 400); the error lists the parameter names that were sent.
- The app is launched for one patient. With a `patient/...` permission, searches return only
  that patient's data; you do not pass the patient yourself.
- **Updating**: read the resource, change the copy, pass the whole copy to `fhir.update()`.
  The EHR refuses an update that does not carry the version that was read (status 428) and one
  made on an outdated copy (status 412): read again and retry. Never build the resource to
  update from scratch.
- **Deleting**: `fhir.delete(resource)` with the resource as read. Ask the clinician before
  building anything that deletes from the record.
- **Filing a document**: `fhir.createDocumentReference()`: the file inline, at most 10 MiB,
  with a `type` code from the clinic's document kinds (`urn:tiro-health:document-kind`). Do
  not set `date` or `context`; the EHR refuses them.
- The EHR does not send related resources along with a search (`_include`) today.

## The `fhir` helper (server only)

`import { fhir } from '@/lib/fhir.server'`. It works only inside a server function or a route
loader, and answers for the visitor of the request being handled.

```ts
const ctx = await fhir.context()
// { patient, encounter, practitioner, fhirUser, fhirVersion, scopes, intent }
// patient / encounter / practitioner are ids, or null

const patient = await fhir.read('Patient', ctx.patient)

// Any parameter name. A list repeats the parameter ("all of these");
// a comma inside one value means "any of these".
const finished = await fhir.search('Encounter', { status: 'finished' })
const recent = await fhir.search(
  'Encounter',
  { date: 'ge2026-01-01' },
  { max: 50 },
)

// The matches plus whatever the EHR sent along (_include, _revinclude).
const { matches, included } = await fhir.searchWithIncluded('Encounter', {
  _include: 'Encounter:subject',
})

const made = await fhir.create<Basic>({
  resourceType: 'Basic',
  code: { text: 'settings' },
})
const changed = await fhir.update({ ...made, code: { text: 'new settings' } })
await fhir.delete(changed) // or fhir.delete('Basic', id, { version })

// Anything else under the FHIR base: an operation, a patch, a version read.
// The path is relative; it cannot name another address.
// Today the Tiro EHR has none of those; `metadata` is the one use.
const statement = await fhir.request('GET', 'metadata')

const saved = await fhir.createDocumentReference({
  type: 'report', // a code from the clinic's document kinds
  title: 'Score result',
  contentType: 'text/plain',
  data: 'The text or the bytes of the file',
})
```

Resources are typed with FHIR R4 types (`import type { Patient } from 'fhir/r4'`). Never write
your own resource types. `search` follows the EHR's pages by itself, up to `max` (200).

It throws three kinds of error (from `@/lib/fhir.server`):

- `NotLaunchedError`: the app was not opened from the EHR, or the session ended. Wrap the call
  in `fromEhr()` (below) so the page gets `{ launched: false }` instead of an error.
- `ScopeRefusedError`: the app was not granted the permission this call needs. `error.scope`
  names it (see "Permissions").
- `FhirRequestError`: any other refusal; `error.status` is the HTTP status. Its message is
  safe to show and says what to do where it can (an unknown search parameter, a type the EHR
  does not serve, a missing or outdated version). Never show or log `error.outcome`: it is the
  EHR's own text and can contain ids.

## Building a feature: the pattern

Example: "show the patient's last three encounters".

1. **A server function** in `src/lib/ehr.functions.ts` (or a new `src/lib/<topic>.functions.ts`):

   ```ts
   export const getLastEncounters = createServerFn({ method: 'POST' }).handler(
     () =>
       fromEhr(async () => {
         const encounters = await fhir.search('Encounter')
         return encounters
           .sort((a, b) =>
             (b.period?.start ?? '').localeCompare(a.period?.start ?? ''),
           )
           .slice(0, 3)
       }),
   )
   ```

   Use `method: 'POST'` so the answer is never cached. Return only what the page shows.

2. **A hook** in `src/hooks/ehr.ts`, next to `usePatient()` and `useEncounters()`:

   ```ts
   export const lastEncountersQuery = queryOptions({
     queryKey: ['ehr', 'last-encounters'],
     queryFn: () => getLastEncounters(),
   })
   export function useLastEncounters() {
     const { data, ...rest } = unwrap(useQuery(lastEncountersQuery))
     return { encounters: data ?? [], ...rest }
   }
   ```

3. **The page** uses the hook. `launched` is false when the app was opened directly; decide
   with the clinician what the page shows then (nothing, or the tool with manual input). A page
   that makes no sense without a patient can send the visitor to the explanation page:
   `<Navigate to="/not-launched" search={{ reason: 'not-from-ehr' }} />`.

4. **Preload** in the route (`loader: ({ context }) => context.queryClient.prefetchQuery(lastEncountersQuery)`)
   so the data is there when the page first appears.

5. **Test** the page with the server function mocked, as in `src/pages/home.test.tsx`, using
   the invented data from `dev/synthetic-data.mjs`. Use `patientName()`, `formatDate()` and
   `encounterTitle()` from `@/lib/fhir/format` to show names and dates.

Existing hooks: `usePatient()` gives `{ patient, launched, isLoading, error }`;
`useEncounters()` gives `{ encounters, launched, isLoading, error }`, most recent first.

## Permissions: `smart.json`

`smart.json` at the root of the repository lists what the app asks the EHR for:

```json
{
  "requiresPatient": true,
  "scopes": [
    "launch",
    "openid",
    "fhirUser",
    "patient/Patient.rs",
    "patient/Encounter.rs",
    "offline_access",
    "user/Basic.cruds"
  ]
}
```

- A scope is `patient/<ResourceType>.<letters>`: `r` read one, `s` search, `c` create,
  `u` update, `d` delete. `patient/Observation.rs` reads and searches the launched patient's
  observations; `patient/DocumentReference.c` files documents. `user/<ResourceType>.<letters>`
  is for data that does not belong to one patient, such as the app's own saved state
  (`user/Basic.cruds`).
- `smart.json` is the app's own record of what it needs, and the local preview grants exactly
  what it lists. **The hosting platform does not read it yet**: online, the app gets what Tiro
  registered for it in the EHR and the clinic approved, which can be less than the app asks.
- **To add one**: add the line to `scopes`, run `pnpm check`, and tell the clinician once,
  plainly: the extra access works in the local preview at once, but online it only works after
  they ask Tiro to add it to the app's registration and the clinic approves it. Ask for the
  least the tool needs.
- `requiresPatient` is `true` when the tool is about one patient. Leave the first three scopes
  and `offline_access` as they are.
- A `ScopeRefusedError` names the scope that was not granted, in the words of `smart.json`
  when that already lists it (then only Tiro's registration is missing). Never catch it to hide it. Build
  the page so the rest still works when one kind of data is refused, and say which is missing.
- `fhir.context()` can return `practitioner: null`: the EHR does not always say who is signed
  in. Do not assume a practitioner.

## Trying it locally

`pnpm dev` starts the app with a pretend EHR beside it (invented data, nothing real):

- http://localhost:3001 shows the app **as opened from the EHR**, for the invented patient
  "Jeanne Voorbeeld" with three encounters. Add `/launch?patient=synthetic-patient-2` for the
  second patient, or `/launch?fail=expired` (or any other reason code) to see the explanation page.
- http://127.0.0.1:3000 shows the app **as opened directly**, without a patient.

The pretend EHR grants exactly the scopes in `smart.json`, so a missing scope shows up locally.
It serves the same resource types, interactions and search parameters as the real EHR
(`dev/facade-capabilities.mjs`) and forgets every change when it restarts. To have data of
another type in the preview, add invented resources to `otherResources` in
`dev/synthetic-data.mjs`, each pointing at its patient with `subject` or `patient`. A type the
real EHR does not serve can be read and searched in the preview that way, but will answer 404
online: say so to the clinician.

`pnpm test:e2e` builds the app and drives it in a real browser behind the pretend EHR. Run it
after changing anything that uses EHR data.

Running against the real EHR on a developer's machine (the EHR local stack and the real
sidecar) is for Tiro's developers, not for the clinician: `e2e-ehr/README.md`. Never edit that
folder, and never copy from it: it plays the EHR's side of a launch, which an app must not do.
The pretend EHR is enough to build and publish.

## What to tell the clinician

- Where the data comes from: "the patient you have open in the EHR".
- That the app shows this data but does not keep it: closing the app forgets it.
- When something is refused online: which access is missing and that Tiro approves it.
