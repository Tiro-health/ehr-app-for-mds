---
name: publish
description: Publish the app to GitHub Pages and report the public URL. Use when the clinician asks to publish, deploy, go live, share the app, or wants the latest version online.
---

# Publish

The app deploys by pushing to `main`. The workflow in `.github/workflows/deploy.yml` builds it,
enables GitHub Pages on first run, and publishes to `https://<owner>.github.io/<repo>/`.

## Steps

1. Run `pnpm check`. Fix anything it reports; never publish a broken build.
2. Make sure all work is committed on `main`. Commit with a plain-language message if not.
3. `git push origin main`.
4. Watch the run: `gh run watch --exit-status` (or `gh run list --workflow deploy.yml --limit 1`
   and poll). If `gh` is unavailable, tell the clinician to open the **Actions** tab on GitHub and
   wait for the green check.
5. On success, derive the URL from `git remote -v`: owner and repo name, so
   `https://<owner>.github.io/<repo>/`. For a repo named `<owner>.github.io` it is
   `https://<owner>.github.io/`. Confirm it loads with `curl -sI <url>` (HTTP 200).
6. Report the URL in one line. Mention that the first deployment can take a minute or two to
   become reachable.

## When it fails

- **Pages not enabled** ("Get Pages site failed" or 404 on the Pages API): enable it with
  `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`, then re-run the workflow with
  `gh run rerun <id>`. Without `gh`, guide the clinician: repository **Settings**, **Pages**,
  set **Source** to **GitHub Actions**, then re-run the failed workflow from the **Actions** tab.
- **Workflow permissions**: if the run fails with a permissions error, the clinician must allow
  Actions to write: **Settings**, **Actions**, **General**, **Workflow permissions**, choose
  **Read and write**.
- **Build or check failure**: read the log with `gh run view <id> --log-failed`, fix locally,
  commit, push again.
- **Blank page after deploy**: the base path is wrong. The workflow sets `BASE_PATH`; do not
  hardcode a base in `vite.config.ts`. Check the browser console for 404s on `/assets/`.
