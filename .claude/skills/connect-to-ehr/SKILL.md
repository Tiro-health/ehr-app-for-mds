---
name: connect-to-ehr
description: Build features that use patient data from the Tiro EHR. Use when the clinician's tool needs the patient that is open in the EHR, their encounters or documents, wants to file something in the record, asks to "show the patient's ...", mentions launching the app from the EHR, or when an error mentions a refused scope or smart.json.
---

# Connect to the EHR

The clinician opens a patient in the Tiro EHR and starts this app from the patient's Apps tab.
The SMART sidecar that runs beside the app does everything security-related: the EHR launch, the
OAuth sign-in, the session and the tokens. **There is no launch, sign-in or token code in this
app, and you never write any.** The app's server asks the sidecar for FHIR data through the `fhir`
helper, and the sidecar answers for the visitor of the request.

Patient data passes through this app's server code on its way to the page, so the six rules in
`CLAUDE.md` ("Patient data from the EHR") apply to everything you build here. If a request can
only be met by breaking one, tell the clinician in one sentence that this app cannot do that and
that Tiro can advise.

## What the EHR serves: read the FHIR guide first

Before building on a resource type, a search parameter or an interaction, fetch the guide of the
FHIR facade. Do not rely on memory or on the local test EHR, which serves more than the real one.

- R4: https://fhir.tirohealth.app/latest/r4/en/llms.txt
- R5: https://fhir.tirohealth.app/latest/r5/en/llms.txt

Each file indexes the pages of that guide as Markdown, relative to its own address (for example
`.../r4/en/StructureDefinition-ehr-encounter.md`). Fetch only the pages the feature needs:

- `CapabilityStatement-ehr-facade.md`: the resource types the facade serves, the interactions
  (read, search, create, update, delete) and the search parameters of each. A type, interaction or
  parameter not listed there is not served: tell the clinician it is not available instead of
  working around it.
- `StructureDefinition-<profile>.md`: the fields of a resource and the code systems it uses.
- `CodeSystem-<name>.md`: the codes (for example the document kinds for `createDocumentReference`).

Use R4 unless the feature needs something only R5 has (the guide says which, for example billing
resources). The `fhir` helper and `@/hooks/ehr` speak R4. The local test EHR in `compose.yaml` is
R4 too.

## The `fhir` helper (server only)

`import { fhir } from '@/lib/fhir.server'`. It works only inside a server function or a route
loader. Type resources with `import type { Patient } from 'fhir/r4'`; never write your own
resource types.

```ts
const ctx = await fhir.context() // { patient, encounter, practitioner, fhirUser, scopes, ... }; ids or null
const patient = await fhir.read('Patient', ctx.patient)
const done = await fhir.search('Encounter', { status: 'finished' }, { max: 50 })
const made = await fhir.create<Basic>({
  resourceType: 'Basic',
  code: { text: 'settings' },
})
const changed = await fhir.update({ ...made, code: { text: 'new' } })
await fhir.delete(changed)
await fhir.createDocumentReference({
  type: 'report',
  title: 'Score',
  contentType: 'text/plain',
  data,
})
```

- Text and code search parameters match exactly. Filter and sort further in the server function.
  Searches return only the launched patient's data with a `patient/...` scope.
- To update, read the resource, change the copy and pass the whole copy back. The EHR refuses an
  update without the version that was read (428) or on an outdated copy (412): read again and retry.
- `createDocumentReference`: the file inline, at most 10 MiB. Do not set `date` or `context`.
- Ask the clinician before building anything that deletes from the record.

Errors, from `@/lib/fhir.server`: `NotLaunchedError` (opened directly, or the session ended: wrap
calls in `fromEhr()` so the page gets `{ launched: false }`), `ScopeRefusedError` (`error.scope`
names the missing permission) and `FhirRequestError` (`error.status`; its message is safe to
show). Never show or log `error.outcome`: it is the EHR's text and can contain ids.

## Building a feature

Pages ask the EHR through the hooks in `@/hooks/ehr`, which sit on one small set of server
functions (`src/lib/ehr.functions.ts`) that works for every resource type. **A feature normally
needs no new server code.** Example, "the patient's last three encounters":

```tsx
const { resources, launched, isLoading, error } = useFhirSearch('Encounter')
const lastThree = [...resources]
  .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))
  .slice(0, 3)
```

- `launched` is false when the app was opened directly: decide with the clinician what the page
  shows then, or send the visitor to `<Navigate to="/not-launched" search={{ reason: 'not-from-ehr' }} />`.
- Preload in the route so the data is there at first paint:
  `loader: ({ context }) => context.queryClient.prefetchQuery(searchQuery('Encounter'))`, with the
  same type, parameters and options as the hook.
- Test the page with `@/lib/ehr.functions` mocked, as in `src/pages/home.test.tsx`, using the
  invented data in `fixtures/r4/`. `@/lib/fhir/format` has `patientName()`, `formatDate()` and
  `encounterTitle()`.

| Hook                                                    | Gives                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useEhrContext()`                                       | `{ context }`: ids of the launched patient, encounter, user and the scopes   |
| `usePatient()`, `useEncounters()`                       | the launched patient; their encounters, most recent first                    |
| `useFhirRead(type, id)`                                 | `{ resource }`                                                               |
| `useFhirSearch(type, params?, { max }?)`                | `{ resources, included }`                                                    |
| `useFhirCreate()`, `useFhirUpdate()`, `useFhirDelete()` | a mutation; pass the resource as it was read; EHR data is refetched after it |

Write a server function of your own (`src/lib/<topic>.functions.ts`, `createServerFn`,
`fromEhr()`, `fhir`) only when the server must do the work: filing a document, or trimming a
large or sensitive resource of which the page shows one field.

## Permissions: `smart.json`

`smart.json` lists what the app asks the EHR for (`requiresPatient` and `scopes`). A scope is
`patient/<ResourceType>.<letters>` with `r` read, `s` search, `c` create, `u` update, `d` delete;
`user/Basic.cruds` is the app's own saved state. Leave `launch`, `openid`, `fhirUser` and
`offline_access` as they are.

- The local preview grants exactly what `smart.json` lists. The hosting platform does not read it
  yet: online, the app gets what Tiro registered for it and the clinic approved, which can be less.
- To add a scope: add it to `smart.json` and to `SMART_SCOPES` in `compose.yaml` (without `launch`,
  `openid`, `fhirUser`), run `pnpm check`, then tell the clinician once: it works in the preview at
  once, but online only after Tiro adds it to the app's registration and the clinic approves it.
  Ask for the least the tool needs.
- Build the page so the rest still works when one kind of data is refused, and say which is
  missing. Never catch `ScopeRefusedError` to hide it. `fhir.context().practitioner` can be null.

## Trying it locally

`docker compose up`, then `pnpm dev`. The sidecar runs in dev mode against fhir-candle with the
invented data in `fixtures/`, as described in `CLAUDE.md` ("The local EHR"), with the same
debug scenarios at http://localhost:8080/_dev. Try each scenario that matters for the feature.
fhir-candle is more permissive than the real EHR (`fixtures/README.md` lists the differences):
a type that works locally but is not in the facade's CapabilityStatement answers 404 online.
To have data of another type locally, add an invented file to `fixtures/r4/` (and `r5/`), pointing
at `Patient/patient-1`, then `docker compose restart fhir-candle`. `pnpm test:e2e` drives the built
app against the local EHR through the scenarios; run it after changing anything that uses EHR data.

## What to tell the clinician

- Where the data comes from: "the patient you have open in the EHR".
- That the app shows this data but does not keep it: closing the app forgets it.
- When something is refused online: which access is missing and that Tiro approves it.
