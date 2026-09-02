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
- Patient data: this app runs in the browser and stores data only on the device. If the clinician
  wants to record real patient data, remind them once, briefly, that the browser is the security
  boundary and data can be lost with the browser profile. See the `local-data` skill when it exists.

## Skills

- `/onboarding` is the entry point for a fresh repo. It settles what the app is and publishes it.
- `/publish` gets the app live on GitHub Pages and reports the URL.

## Stack (do not change)

| Concern       | Choice                                              |
| ------------- | --------------------------------------------------- |
| Language      | TypeScript, strict                                  |
| Framework     | React 19 + Vite                                     |
| Routing       | TanStack Router, file-based routes in `src/routes/` |
| Styling       | Tailwind CSS v4                                     |
| UI components | shadcn/ui on Base UI, in `src/components/ui/`       |
| Icons         | lucide-react                                        |
| Tests         | Vitest + Testing Library                            |
| Hosting       | GitHub Pages via `.github/workflows/deploy.yml`     |

There is no backend. Everything runs in the browser.

## Layout

```
src/
  app.config.ts        App name and tagline. Edit this to rename the app.
  main.tsx             Router setup. Rarely touched.
  styles.css           Tailwind and theme variables (colours live here).
  routes/              One file per URL. __root.tsx is the shared layout with the header.
  pages/               The actual page content, one file per page, plus its test.
  components/          Reusable pieces built for this app.
  components/ui/       shadcn components. Add more with `pnpm dlx shadcn@latest add <name>`.
  lib/                 Helpers.
```

## Conventions

- **New page**: create `src/routes/<name>.tsx` that renders a component from `src/pages/<name>.tsx`.
  Add a link in the header in `src/routes/__root.tsx`. The route tree regenerates on its own.
- **UI**: use the shadcn components in `src/components/ui/` before writing custom markup. Add
  missing ones with the shadcn CLI, never by hand. Never edit files in `src/components/ui/`.
- **Imports**: use the `@/` alias for anything under `src/`.
- **State**: React state in the page. No global state library unless a skill introduces one.
- **Tests**: every page gets a small test next to it that renders it and checks the heading.
  Clinical calculations get unit tests with the reference values from the source publication.
- **Formatting and lint**: `pnpm format` fixes, `pnpm check` verifies (types, lint, format, tests).
- **Deploy**: pushing to `main` deploys. The base path is set by the workflow, never hardcode it.
- **No new dependencies** unless they replace real complexity. Prefer plain code.

## Commands

```
pnpm install     install dependencies (once)
pnpm dev         local preview at http://localhost:3000
pnpm check       types, lint, format, tests
pnpm format      auto-fix formatting and lint
pnpm build       production build into dist/
```
