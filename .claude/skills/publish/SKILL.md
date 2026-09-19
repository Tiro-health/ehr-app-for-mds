---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is the name Tiro approved
it under. Every push to `main` runs `.github/workflows/build.yml`, which uses Tiro's shared
workflow to run `pnpm check` and `pnpm build` and package the app. When both pass, **Tiro
Deploy**, a GitHub App installed on this repository, checks the app is approved and puts it
online. It reports the result as a check called **Tiro.health Deploy (production)** on the pushed
commit, a minute or so after the workflow finishes.

Everything here needs `gh`, logged in (`gh auth status`). If it is missing, install it and run
`gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

## 1. Check and push

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on `main`. Commit with a plain-language message if not.
3. `git push origin main`.

## 2. Wait for Tiro Deploy's check

Get the owner and repository from `git remote -v` and the commit with `git rev-parse HEAD`, then
poll every 15 seconds, for up to 15 minutes, until the check is completed:

```bash
gh api repos/<owner>/<repo>/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.app.slug == "tiro-health-deploy") | {status, conclusion, title: .output.title, summary: .output.summary, url: .details_url, log: .output.text}'
```

The workflow plus the deploy usually take three to five minutes. Tell the clinician it is on its
way while you wait. Follow the workflow with `gh run watch` on the latest `build.yml` run.

## 3. Act on the result

- **The Build workflow failed**: `pnpm check` or `pnpm build` failed, and nothing was deployed.
  Tiro Deploy then reports "Checks or build did not pass". Read the log with
  `gh run view <id> --log-failed`, fix, commit, push again.
- **No Tiro Deploy check appears within a minute after the workflow passed**: Tiro Deploy is not
  installed on this repository. Ask the clinician to open https://github.com/apps/tiro-health-deploy/installations/new,
  choose their account, pick **Only select repositories**, select this repository and install.
  Then publish again with an empty commit: `git commit --allow-empty -m "Publish"` and push.
- **"This repository is not registered"**: Tiro has not approved the app yet. Look for the
  request:
  `gh issue list --repo Tiro-health/ehr-app-build --label app-registration --state all --search "<owner>/<repo> in:body"`.
  - Open: it is waiting for Tiro. If it is labelled `needs-changes`, read the check's comment
    and fix the request with the clinician. Tell them you will publish again once it is approved.
  - Closed as approved: publish again with an empty commit as above.
  - None: file one as in step 3 of the `onboarding` skill.
- **"… is suspended"**: Tiro has paused the app. Tell the clinician to contact Tiro.
- **"No image to deploy"**: `.github/workflows/build.yml` was changed. Restore it to call Tiro's
  shared workflow unchanged, commit, push again.
- **"Could not import the image"**, **"Deploy failed"** or **"Could not start the deploy"**: a
  problem on Tiro's side, not in the app. The previous version stays online. Re-run the workflow
  once (`gh run rerun <id>`); if it fails again, tell the clinician to contact Tiro.
- **"Live at …"**: confirm the URL answers with `curl -sI <url>` (HTTP 200) and report it in one
  line.

## Releases

Until Tiro adds a staging environment, every push to `main` goes straight to production. Later,
`main` will go to a staging address first and a release tag (`v1`, `v2`, …) to production; this
skill will then create the tag.
