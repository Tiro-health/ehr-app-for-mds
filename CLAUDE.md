# CLAUDE.md

This repository is a clinician's own web app, created from the Tiro.health template for building
clinical tools with Claude Code. The person you are working with is a medical doctor, usually with
**no programming experience**. Assume they will never read the code. They read your messages.

## How to work with the clinician

- Talk in plain language. Say "page", "button", "saved data", not "route", "component", "IndexedDB".
- Do the whole task. Never hand back a step that requires editing a file by hand.
- Before changing something big, say in one or two sentences what you are about to do. After, say
  what changed and where they can see it (the local preview or the public URL).
- Keep the app in a working state after every change: run `pnpm check` before you finish.
- Commit after each completed piece of work with a message the clinician would understand.
- When something fails, fix it. Only ask the clinician when the decision is theirs (what the tool
  should do, what it is called, what it should look like).
- Saved data: when the app is opened from the EHR, what it saves with `useAppState` is stored in
  the EHR for the signed-in clinician. Opened on its own, it is saved in the browser only, and can
  be lost with the browser profile. If the clinician wants to record real patient data, remind
  them once, briefly, that saved app data is for settings and tool state, not for the patient
  record.
- Patient data from the EHR: when the tool needs the patient that is open in the EHR, use the
  `connect-to-ehr` skill and follow "Patient data from the EHR" below to the letter.

## Skills

- `/onboarding` is the entry point for a fresh repo. It settles what the app is and publishes it.
- `/publish` gets the app live at `https://<app>.tirohealth.app` and reports the URL.
- `connect-to-ehr` is how to build anything that reads or files patient data in the Tiro EHR.

## Stack (do not change)

| Concern       | Choice                                               |
| ------------- | ---------------------------------------------------- |
| Language      | TypeScript, strict                                   |
| Framework     | React 19 + TanStack Start (server rendering), Vite   |
| Routing       | TanStack Router, file-based routes in `src/routes/`  |
| Styling       | Tailwind CSS v4                                      |
| UI components | shadcn/ui on Base UI, in `src/components/ui/`        |
| Icons         | lucide-react                                         |
| EHR data      | `fhir` helper on the server, TanStack Query in pages |
| Tests         | Vitest + Testing Library, Playwright for the browser |
| Hosting       | tirohealth.app via Tiro's shared build workflow      |

Pages are rendered on a small Node server (built by Nitro into `.output/`) and then take over in the browser. The
server keeps no data: it renders pages and, when the app was opened from the EHR, passes the
patient's data from the EHR to the page. Everything the app stores stays in the browser.

## Patient data from the EHR

The clinician can start the app from a patient's Apps tab in the Tiro EHR. The hosting platform
does that launch and gives the app's server a private connection to the clinic's FHIR data. The
app contains no launch, sign-in or session code. Server functions and route loaders read and
write FHIR through `fhir` from `@/lib/fhir.server`; pages use the hooks in `@/hooks/ehr`. The
`connect-to-ehr` skill has the details and a worked example.

So patient data from the EHR passes through this app's server code. These rules are absolute:

1. **Never log patient data.** Not on the server, not in the browser: no `console.*` of a
   resource, a name, an id, a search value or an EHR error body, and no patient data in error
   messages or web addresses.
2. **Never keep patient data on the server between requests.** No variable outside a function,
   no cache, no file, no database. Fetch it, return it, forget it.
3. **Never send patient data to another host.** The server talks to the EHR through the `fhir`
   helper and to nothing else; no other service (AI, analytics, error tracking, e-mail, webhook)
   receives patient data, from the server or from the browser.
4. **Never write code that handles a token, a key or an OAuth redirect.** No sign-in code, no
   `Authorization` header, no reading or setting of cookies. No SMART or EHR environment
   variables exist; never add one.
5. **`/launch`, `/callback` and `/.well-known/jwks.json` are reserved** for the platform. Never
   define a page or file there. `pnpm check` fails if one appears.
6. **Never put real patient data in the repository.** Test data is invented and lives in
   `fixtures/`.

If a request can only be met by breaking one of these, do not build it. Tell the clinician it is
not possible in this app and that Tiro can advise.

What the app needs from the EHR is listed in `smart.json` (the scopes). The local EHR in
`compose.yaml` grants exactly that list (`SMART_SCOPES`; `pnpm check` keeps the two equal). Online, the app gets what Tiro registered for it and the clinic approved; the
platform does not read `smart.json` yet. Add a scope there when a feature needs more; the skill
explains how and what to tell the clinician.

## Layout

```
src/
  app.config.ts        App name and tagline. Edit this to rename the app.
  hooks/ehr.ts         usePatient(), useFhirSearch(), useFhirRead(), ...: EHR data for pages.
  hooks/use-app-state.ts useAppState(): settings saved for the clinician (in the EHR when launched).
  lib/fhir.server.ts   The `fhir` helper. Server only.
  lib/ehr.functions.ts Server functions behind the hooks. They work for any resource type.
  router.tsx           Router setup. Rarely touched.
  styles.css           Tailwind and theme variables (colours live here).
  routes/              One file per URL. __root.tsx is the HTML shell and the shared header.
  pages/               The actual page content, one file per page, plus its test.
  components/          Reusable pieces built for this app.
  components/ui/       shadcn components. Add more with `pnpm dlx shadcn@latest add <name>`.
  lib/                 Helpers.
smart.json             What the app needs from the EHR (scopes). Checked by `pnpm check`.
compose.yaml           The local EHR: Tiro's sidecar in dev mode and a FHIR server with fixtures/.
fixtures/              Invented FHIR data the local EHR starts with (r4/ and r5/).
e2e/                   Browser test of the built app against the local EHR.
.github/workflows/     build.yml: checks, builds and publishes through Tiro's shared workflow.
```

## The local EHR

`docker compose up` starts the EHR on this machine, then `pnpm dev` starts the app at
http://127.0.0.1:3000. The app talks to the EHR exactly as it does online: through Tiro's SMART
sidecar at http://127.0.0.1:8081. Here the sidecar runs in **dev mode**: there is no launch from
the EHR and no sign-in; it holds one fixed session against fhir-candle, a FHIR server loaded with
the invented data in `fixtures/` (patient `patient-1`, encounters `encounter-1` to `-3`,
practitioner `practitioner-1`). Changes are kept until the container restarts.

A **debug scenario** decides what that session is. Switch it at http://localhost:8080/_dev while
it runs, or start with one: `SMART_DEV_SCENARIO=no-patient docker compose up`.

| Scenario            | What the app gets                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- |
| `patient` (default) | Opened for `patient-1`, no encounter                                                  |
| `patient-encounter` | Opened for `patient-1` during `encounter-1`                                           |
| `no-patient`        | Opened from the EHR without a patient                                                 |
| `scope-denied`      | Opened for `patient-1`, but granted only `patient/Patient.rs`: other requests get 403 |
| `expired`           | No session: as if opened directly, or after the session ended (401)                   |

A real launch from a patient's Apps tab first happens after the app is published (see `/publish`).
Docker must be installed (Docker Desktop on a laptop). Never change `compose.yaml` except
`SMART_SCOPES` (to match `smart.json`) and the ids, and never edit `fixtures/` with real data.

## Conventions

- **New page**: create `src/routes/<name>.tsx` that renders a component from `src/pages/<name>.tsx`.
  Add a link in the header in `src/routes/__root.tsx`. The route tree regenerates on its own.
- **UI**: use the shadcn components in `src/components/ui/` before writing custom markup. Add
  missing ones with the shadcn CLI, never by hand. Never edit files in `src/components/ui/`, with
  one exception: the CLI sometimes writes `import { cn } from "cn"` and adds a `cn` package. Point
  the import at `@/lib/utils` and run `pnpm remove cn`.
- **Imports**: use the `@/` alias for anything under `src/`.
- **Saving data**: use `useAppState(key, initial, { parse })` from `@/hooks/use-app-state` like
  `useState`. Keys are short lowercase names (`click-count`). Values must be JSON and stay well
  under 256 KB; always pass `parse` to check what comes back, because stored values are untrusted.
  App State is for settings and tool state only: never use it for clinical facts (diagnoses,
  observations, patient registries). The SMART spec forbids that.
- **Browser-only code**: pages also render on the server, where `window`, `localStorage` and
  IndexedDB do not exist. Touch them only in `useEffect` or event handlers, never while rendering.
- **Server functions**: only for EHR data, following "Patient data from the EHR". They never
  store anything. Data the clinician types into the app goes to the server only to be saved in
  the EHR (a create or update), and is never kept there.
- **State**: React state in the page. EHR data comes from the hooks in `@/hooks/ehr` (TanStack
  Query). No other global state library unless a skill introduces one.
- **Tests**: every page gets a small test next to it that renders it and checks the heading.
  Clinical calculations get unit tests with the reference values from the source publication.
  A page that uses EHR data is tested with the server function mocked and the data in
  `fixtures/`, and `pnpm test:e2e` is run (with `docker compose up`) before finishing.
- **Formatting and lint**: `pnpm format` fixes, `pnpm check` verifies (types, lint, format, tests).
- **Deploy**: pushing to `main` publishes (see `/publish`). `.github/workflows/build.yml` runs
  `pnpm check` and `pnpm build` through Tiro's shared workflow; both must pass before anything is
  published. Its `app:` line reads the repository variable `TIRO_EHR_APP_NAME`, which the EHR's
  setup page sets when the repository is linked. Change nothing in the file.
- **No new dependencies** unless they replace real complexity. Prefer plain code.

## Commands

```
pnpm install     install dependencies (once)
docker compose up   the local EHR (leave it running; `docker compose down` stops it)
pnpm dev         local preview at http://127.0.0.1:3000, against the local EHR
pnpm check       types, EHR manifest, compose scopes and reserved addresses, lint, format, tests
pnpm test:e2e    builds the app and drives it in a browser against the local EHR
pnpm format      auto-fix formatting and lint
pnpm build       production build into .output/
pnpm start       run the production build at http://localhost:3000 (or the port in `PORT`)
```
