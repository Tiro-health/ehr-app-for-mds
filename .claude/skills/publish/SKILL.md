---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is the name it was registered
under in Tiro's app manager. Registering there connects this repository and sets the repository
variable `TIRO_APP` to that name. Pushing to `main` runs `.github/workflows/deploy.yml`: it checks
the app and, once `TIRO_APP` is set, publishes it.

Everything here needs `gh`, logged in (`gh auth status`). If it is missing, install it and run
`gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

## 1. Check and push

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on `main`. Commit with a plain-language message if not.
3. `git push origin main`.

## 2. Check that the app is registered

Run `gh variable get TIRO_APP`.

- **It has a value**: go to step 3.
- **It is missing**: the app is not registered yet. Tell the clinician in one or two sentences
  that the app needs a web address before it can go online, and that they get one by registering
  this repository in Tiro's app manager. Once they have, re-run the last deploy with
  `gh run rerun $(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
  and go to step 3.

## 3. Watch the deploy and report

1. Watch the run: `gh run watch --exit-status` on the latest `deploy.yml` run.
2. On success, confirm `https://<app>.tirohealth.app` answers with `curl -sI` (HTTP 200).
3. Report the URL in one line.

## When it fails

- **Check job fails**: read the log with `gh run view <id> --log-failed`, fix locally, commit,
  push again.
- **Deploy fails at "google-github-actions/auth"** (`unauthorized_client`, `Permission denied`):
  the name in `TIRO_APP` is not registered for this repository. Ask the clinician to check the
  registration in Tiro's app manager.
- **Deploy fails at "Build app"**: the same build runs locally with `pnpm build`. Fix it, commit,
  push again.
