---
name: publish
description: Publish the app to its own web address on tirohealth.app and report the URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app is published at `https://<app>.tirohealth.app`, where `<app>` is its name on Tiro. Every
push to `main` runs `.github/workflows/build.yml`, which calls Tiro's shared workflow
(`Tiro-health/ehr-app-build`, `@v2`): the **Tiro.health / App / Build** check runs `pnpm check`
and `pnpm build` and packages the app; the **Tiro.health / App / Publish** check then puts it
online and writes the address to the run's summary under "Published". Pull requests are checked and built, never published.

Everything here needs `gh`, logged in (`gh auth status`). If it is missing, install it and run
`gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

## 0. The app's name

`.github/workflows/build.yml` reads the app's name from the repository variable
`TIRO_EHR_APP_NAME`; never edit the file for it. Check it with `gh variable get TIRO_EHR_APP_NAME`.
If it is missing, the repository is not linked yet: once Tiro has registered the app, the
clinician signs in with GitHub on the EHR's setup page (https://ehr.tiro.health/platform/setup)
and links this repository. Tiro.health then sets the variable and starts the first publish itself.
If the setup page says it could not set the variable, it shows a `gh variable set` command: run
that command, then `gh workflow run build.yml --ref main` once the page says the app is ready.

## 0b. The Tiro.health deploy app

Tiro puts the app online through a GitHub app, **tiro-health-deploy**. If it is not installed on
this repository, nothing is published, however green the build is. Check this before the first
publish, and again whenever Publish fails with a message about the deploy app or about access to
the repository.

`gh` cannot ask GitHub directly which repositories an app covers, so look for evidence, in order:

1. `gh api repos/{owner}/{repo}/commits?per_page=10 -q '.[].sha'`, then for each sha
   `gh api repos/{owner}/{repo}/commits/<sha>/check-suites -q '.check_suites[].app.slug'`. If
   `tiro-health-deploy` appears on a recent commit, it is installed here. Done.
2. `gh api orgs/<owner>/installations -q '.installations[] | select(.app_slug=="tiro-health-deploy") | .repository_selection'`
   (only for a repository owned by an organization; a 403 means the clinician cannot see this,
   go on to 3). No output: it is not installed. `all`: it is installed here. Done. `selected`:
   it is installed, but maybe not for this repository; go on to 3.
3. Not confirmed. Ask the clinician to open https://github.com/apps/tiro-health-deploy/installations/new,
   choose the account or organization that owns this repository, and make sure this repository
   is ticked (or "All repositories" is chosen), then save. Say in one sentence why: it is what
   lets Tiro put their app online. If GitHub says they can only _request_ it, an owner of the
   organization has to approve the request; tell them so, and that publishing waits until then.

Once it is installed, re-run the last failed run (`gh run rerun <id>`) or carry on with step 1.

## 1. Check and push

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on the default branch (`main` unless the repository says
   otherwise). Commit with a plain-language message if not.
3. Push it (`git push origin main`).

## 2. Wait for the Tiro.health checks

Follow the run with `gh run watch` on the latest `build.yml` run (`gh run list --workflow build.yml
--limit 1`). Checking, building and publishing usually take three to five minutes; tell the
clinician it is on its way while you wait.

## 3. Act on the result

- **Build failed**: `pnpm check` or `pnpm build` failed, and nothing was published. Read
  the log with `gh run view <id> --log-failed`, fix, commit, push again.
- **Publish passed with a "Not published" notice**: the variable is not set, so the
  repository is not linked yet. Nothing went wrong. Do step 0.
- **"The app name … is not valid"**: the variable holds something that is not an app name. Do
  step 0 with the clinician.
- **"This app is still being set up on Tiro"**: a newly linked app; the job retries for up to ten
  minutes by itself. Wait.
- **"This repository is not linked to a Tiro app, or the app is suspended"**: the name on the
  variable names the wrong app, the repository is not linked on the setup page yet, or Tiro paused
  the app. Check the name with the clinician; if it is right, ask them to link the repository on
  the setup page, or to contact Tiro. Then re-run the workflow (`gh run rerun <id>`).
- **Publish fails about the deploy app or access to the repository**, or Build passes but
  Publish never puts anything online: tiro-health-deploy is probably not installed here. Do
  step 0b.
- **Any other failure in Publish**: do step 0b once to rule out the deploy app; otherwise it is a problem on Tiro's side, not in the app. The previous
  version stays online. Re-run once; if it fails again, tell the clinician to contact Tiro.
- **Success**: the run summary names `https://<app>.tirohealth.app`
  (`gh run view <id>` shows it). Confirm it answers with `curl -sI <url>` and report it in one
  line. The app is opened with a patient from that patient's Apps tab in the Tiro EHR, once the
  clinic has approved it: this is the first real launch, after the local EHR of `compose.yaml`.

## Releases

Until Tiro adds a staging environment, every push to `main` goes straight to production. Later,
`main` will go to a staging address first and a release tag (`v1`, `v2`, …) to production; this
skill will then create the tag.
