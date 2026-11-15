---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is its name on Tiro. Every
push to `main` runs `.github/workflows/build.yml`, which calls Tiro's shared workflow
(`Tiro-health/ehr-app-build`, `@v2`): the **Check and build** job runs `pnpm check` and
`pnpm build` and packages the app; the **Publish to Tiro** job then puts it online and writes the
address to the run's summary. Pull requests are checked and built, never published.

Everything here needs `gh`, logged in (`gh auth status`). If it is missing, install it and run
`gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

## 0. The app's name in the workflow

`.github/workflows/build.yml` has `app: <name>`. In a fresh repository it reads
`REPLACE-WITH-YOUR-APP-NAME`. The name comes from Tiro: once Tiro has registered the app, the
clinician signs in with GitHub on the EHR's setup page (https://ehr.tiro.health/platform/setup),
links this repository, and the page shows `build.yml` with the name filled in. Ask the clinician
for that name (lowercase letters, digits and hyphens), put it on the `app:` line, change nothing
else in the file, and commit.

## 1. Check and push

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on `main`. Commit with a plain-language message if not.
3. `git push origin main`.

## 2. Wait for the Build workflow

Follow the run with `gh run watch` on the latest `build.yml` run (`gh run list --workflow build.yml
--limit 1`). Checking, building and publishing usually take three to five minutes; tell the
clinician it is on its way while you wait.

## 3. Act on the result

- **Check and build failed**: `pnpm check` or `pnpm build` failed, and nothing was published. Read
  the log with `gh run view <id> --log-failed`, fix, commit, push again.
- **"No Tiro app given"** or **"The app name … is not valid"**: the `app:` line is missing or
  still the placeholder. Do step 0.
- **"This app is still being set up on Tiro"**: a newly linked app; the job retries for up to ten
  minutes by itself. Wait.
- **"This repository is not linked to a Tiro app, or the app is suspended"**: the name on the
  `app:` line is wrong, the repository is not linked on the setup page yet, or Tiro paused the app.
  Check the name with the clinician; if it is right, ask them to link the repository on the
  setup page, or to contact Tiro. Then re-run the workflow (`gh run rerun <id>`).
- **Any other failure in Publish to Tiro**: a problem on Tiro's side, not in the app. The previous
  version stays online. Re-run once; if it fails again, tell the clinician to contact Tiro.
- **Success**: the run summary names `https://<app>.tirohealth.app`
  (`gh run view <id>` shows it). Confirm it answers with `curl -sI <url>` and report it in one
  line. The app is opened with a patient from that patient's Apps tab in the Tiro EHR, once the
  clinic has approved it: this is the first real launch, after the local EHR of `compose.yaml`.

## Releases

Until Tiro adds a staging environment, every push to `main` goes straight to production. Later,
`main` will go to a staging address first and a release tag (`v1`, `v2`, …) to production; this
skill will then create the tag.
