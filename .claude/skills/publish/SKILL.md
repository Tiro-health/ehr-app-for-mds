---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is its registered name.
Pushing to `main` runs `.github/workflows/deploy.yml`: it checks the app and, once the repository
variable `TIRO_APP` holds the registered name, publishes it. Tiro registers each name by hand for
now, so the first publish has a waiting step.

Everything here needs `gh`, logged in (`gh auth status`). If it is missing, install it and run
`gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

## 1. Check and push

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on `main`. Commit with a plain-language message if not.
3. `git push origin main`.

## 2. Find out where the app stands

Run `gh variable get TIRO_APP`.

- **It has a value**: the app is registered. Go to step 4.
- **It is missing**: look for an open or closed registration request for this repository:
  `gh issue list --repo Tiro-health/ehr-app-for-mds --state all --search "\"<owner>/<repo>\" in:body Register app in:title"`.
  - None: go to step 3.
  - Open: registration is still pending. Tell the clinician their web address is waiting for
    Tiro's approval, and that you will publish it as soon as it is approved. Stop here.
  - Closed with a comment confirming the name: set the variable with
    `gh variable set TIRO_APP --body <app>`, then re-run the last workflow with
    `gh run rerun $(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
    and go to step 4.

## 3. Ask for a web address

1. Ask the clinician for the web address, suggesting two or three names based on the app's name.
   A name is 3 to 20 characters: lowercase letters, digits and hyphens, starting with a letter,
   not ending with a hyphen. Show it as `https://<app>.tirohealth.app`.
2. Open the request:
   ```
   gh issue create --repo Tiro-health/ehr-app-for-mds \
     --title "Register app <app>" \
     --body "Repository: <owner>/<repo>
   Repository id: $(gh api repos/<owner>/<repo> --jq .id)
   Requested address: https://<app>.tirohealth.app"
   ```
3. Tell the clinician in one or two sentences: the address is requested, Tiro approves it by
   hand, and the next time they ask to publish you will check and put the app online.

## 4. Watch the deploy and report

1. Watch the run: `gh run watch --exit-status` on the latest `deploy.yml` run.
2. On success, confirm `https://<app>.tirohealth.app` answers with `curl -sI` (HTTP 200).
3. Report the URL in one line.

## When it fails

- **Check job fails**: read the log with `gh run view <id> --log-failed`, fix locally, commit,
  push again.
- **Deploy fails at "google-github-actions/auth"** (`unauthorized_client`, `Permission denied`):
  the name in `TIRO_APP` is not registered for this repository. Check the variable against the
  closed registration issue. If they match, comment on that issue asking Tiro to check, and tell
  the clinician it is waiting on Tiro.
- **Deploy fails at "Build app"**: the same build runs locally with `pnpm build`. Fix it, commit,
  push again.
