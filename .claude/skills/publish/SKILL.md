---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is the name Tiro approved
it under. Publishing is done by **Tiro Deploy**, a GitHub App installed on this repository: on
every push to `main` it checks the app is approved, builds it and puts it online. It reports the
result as a check called **Tiro Deploy (production)** on the pushed commit.

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

A build usually takes two to four minutes. Tell the clinician it is on its way while you wait.

## 3. Act on the result

- **No Tiro Deploy check appears within a minute**: Tiro Deploy is not installed on this
  repository. Ask the clinician to open https://github.com/apps/tiro-health-deploy/installations/new,
  choose their account, pick **Only select repositories**, select this repository and install.
  Then publish again with an empty commit: `git commit --allow-empty -m "Publish"` and push.
- **"This repository is not registered"**: Tiro has not approved the app yet. Tell the clinician
  in one or two sentences that Tiro approves each app by hand and gives it its web address, and
  that they should send Tiro their repository name (`<owner>/<repo>`) and the name they would
  like for the address. Once approved, publish again as above.
- **"… is suspended"**: Tiro has paused the app. Tell the clinician to contact Tiro.
- **"Build failed"**: the check includes the last lines of the build log. Reproduce with
  `pnpm build` locally, fix, commit, push again.
- **"Deploy failed"** or **"Could not start the build"**: a problem on Tiro's side, not in the
  app. The previous version stays online. Push again once; if it fails again, tell the clinician
  to contact Tiro.
- **"Live at …"**: confirm the URL answers with `curl -sI <url>` (HTTP 200) and report it in one
  line.

## Releases

Until Tiro adds a staging environment, every push to `main` goes straight to production. Later,
`main` will go to a staging address first and a release tag (`v1`, `v2`, …) to production; this
skill will then create the tag.
