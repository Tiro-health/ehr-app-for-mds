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
- Patient data: opened from a patient's chart in the Tiro EHR, the app reads and writes that
  patient's record in the EHR itself (see the `connect-to-ehr` skill); nothing about the patient
  is kept by the app. What the app writes becomes part of the record, so confirm with the
  clinician what will be written. Opened on its own, the app has no patient data; anything it
  saves stays in this browser and can be lost with the browser profile. If the clinician wants to
  record patient data outside the EHR, remind them once, briefly, that the browser is then the
  only safeguard, and suggest writing it to the EHR instead.
- A clinician's own settings are saved with `useAppState`: in the EHR for that clinician once
  the EHR offers it, in the browser until then. Never put patient data in them.

## Skills

- `/onboarding` is the entry point for a fresh repo. It settles what the app is and publishes it.
- `/publish` gets the app live at `https://<app>.tirohealth.app` and reports the URL.
- `connect-to-ehr` is how to read and write the patient's record in the EHR, test it, and run
  it against the local EHR. Load it for anything that touches patient data.

## Stack (do not change)

| Concern       | Choice                                              |
| ------------- | --------------------------------------------------- |
| Language      | TypeScript, strict                                  |
| Framework     | React 19 + TanStack Start (server rendering), Vite  |
| Routing       | TanStack Router, file-based routes in `src/routes/` |
| Styling       | Tailwind CSS v4                                     |
| UI components | shadcn/ui on Base UI, in `src/components/ui/`       |
| Icons         | lucide-react                                        |
| Tests         | Vitest + Testing Library, Playwright end to end     |
| EHR           | SMART on FHIR R4 with the Tiro EHR, types `fhir/r4` |
| Hosting       | tirohealth.app via the Tiro Deploy GitHub App       |

Pages are rendered on a small Node server (built by Nitro into `.output/`) and then take over in
the browser. The server keeps no data of its own. Opening the app from the EHR (SMART on FHIR) is
not this app's job: on tirohealth.app, Tiro's auth proxy answers `/_tiro/*` and
`/.well-known/jwks.json` for every app, signs in to the EHR with a key only Tiro holds, and keeps
the sign-in. The browser asks it for a short-lived access token (`useSmart()`) and reads and
writes the patient's data in the EHR directly; patient data never passes through the app's server.
The app has no keys, secrets or sign-in settings, and needs none.

## Layout

```
src/
  app.config.ts        App name and tagline. Edit this to rename the app.
  router.tsx           Router setup. Rarely touched.
  styles.css           Tailwind and theme variables (colours live here).
  routes/              One file per URL. __root.tsx is the HTML shell and the shared header.
  pages/               The actual page content, one file per page, plus its test.
  components/          Reusable pieces built for this app.
  components/ui/       shadcn components. Add more with `pnpm dlx shadcn@latest add <name>`.
  hooks/               React hooks. use-smart.tsx is the EHR connection, use-fhir.ts reads patient
                       data (usePatient, useEncounters), use-app-state.ts saves data.
  lib/                 Helpers. lib/fhir.ts is the typed FHIR data layer; lib/smart/ is the EHR
                       connection, the EHR client, App State and the fake EHR for tests.
```

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
  Do not add server functions that store, receive or relay patient data: read it in the browser
  with `useSmart()`.
- **State**: React state in the page. No global state library unless a skill introduces one.
- **Tests**: every page gets a small test next to it that renders it and checks the heading.
  Clinical calculations get unit tests with the reference values from the source publication.
  Anything that reads or writes the EHR gets a unit test against the fake EHR and an end-to-end
  test in `e2e/` (see `connect-to-ehr`).
- **Formatting and lint**: `pnpm format` fixes, `pnpm check` verifies (types, lint, format, tests).
- **Deploy**: pushing to `main` deploys, once Tiro Deploy is installed and Tiro approved the app
  (see `/publish`). `.github/workflows/build.yml` runs `pnpm check` and `pnpm build` through
  Tiro's shared workflow; both must pass before anything is deployed. Do not change it.
- **No new dependencies** unless they replace real complexity. Prefer plain code.

## Commands

```
pnpm install     install dependencies (once)
pnpm dev         local preview at http://localhost:3001 (the local EHR uses 3000)
pnpm check       types, lint, format, tests
pnpm test:e2e    end-to-end tests in a real browser (EHR launch tests need the local EHR stack)
pnpm format      auto-fix formatting and lint
pnpm build       production build into .output/
pnpm start       run the production build at http://localhost:3000
```

## Opening from the EHR

- What the app asks to read and write is `ehr.scopes` in `src/app.config.ts`. The app serves it
  at `/.well-known/tiro-app.json`, where Tiro's auth proxy reads it at every launch.
- Never add routes under `/_tiro/` or a `/.well-known/jwks.json`: those paths belong to Tiro's
  auth proxy and never reach the app once it is published.
- Tiro registers the app with the EHR (client id: the app's name; launch URL
  `https://<app>.tirohealth.app/_tiro/auth/launch`). The clinician has nothing to set up.
- Locally, `pnpm dev` runs the app as if it was not opened from the EHR. To open it from the
  local Tiro EHR stack, run the auth proxy and set `TIRO_AUTH_URL` (see `.env.example`).
