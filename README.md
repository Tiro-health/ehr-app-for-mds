# Build your own clinical tool with Claude Code

This template lets you, a clinician, build and publish your own small web app by talking to
Claude Code. No programming needed. Score calculators, protocol lookups, checklists, personal
registries: if you can describe it, you can build it.

## What you need

1. A [GitHub](https://github.com) account.
2. [Claude Code](https://claude.com/claude-code): the desktop app, the web version, or the terminal.

## Get started

1. [**Create your repository from this template**](https://github.com/new?template_owner=Tiro-health&template_name=ehr-app-for-mds&owner=%40me&name=my-clinical-app&description=My+clinical+tool%2C+built+with+Claude+Code&visibility=public).
   Change the name if you like.
2. Open your new repository in Claude Code.
   - Web: go to [claude.ai/code](https://claude.ai/code), connect GitHub, pick the repository.
   - Desktop or terminal: clone the repository and open Claude Code inside it.
3. Type this and press enter:

   ```
   /onboarding
   ```

Claude will ask what you want to build, set the app up, and publish it. The first time, Tiro
registers your app, which gives it a web address on tirohealth.app, and you link your repository
to it on the EHR's setup page. That page shows the one line Claude puts in
`.github/workflows/build.yml`: `app: <your app name>`, in place of `REPLACE-WITH-YOUR-APP-NAME`.
Until then your changes are checked and built, but not published.

## After that

Talk to Claude Code as you would to a colleague who builds things for you:

- "Add a page with the CHA2DS2-VASc score."
- "Show the last three encounters of the patient I have open in the EHR."
- "Make the buttons bigger and the colours calmer."
- "Publish the latest version."

Claude keeps the app working and takes care of publishing.

## Try it with an EHR on your computer

To see the app as it looks when opened from the Tiro EHR, with an invented patient, you need
[Docker Desktop](https://www.docker.com/products/docker-desktop/). Claude starts it for you; by
hand it is:

```
docker compose up -d   # the EHR on your computer, with invented data from fixtures/
pnpm dev               # your app at http://127.0.0.1:3000
```

http://localhost:8080/_dev switches between situations, the "debug scenarios":

| Scenario            | The app is opened...                                         |
| ------------------- | ------------------------------------------------------------ |
| `patient` (default) | for the invented patient                                     |
| `patient-encounter` | for the invented patient, during one of their encounters     |
| `no-patient`        | from the EHR, without a patient                              |
| `scope-denied`      | for the patient, but only allowed to read the patient itself |
| `expired`           | after the session ended, as if opened directly               |

You can also start with one: `SMART_DEV_SCENARIO=no-patient docker compose up -d`.
This uses the same piece of Tiro's platform that runs beside your app online (the SMART
sidecar), so what works here works there. The real launch from a patient's Apps tab first
happens after you publish.

## About your data

Anything you type into your app is stored only in the browser, on the device where it was
entered. It is not sent to a server. That also means the browser is the security boundary and
data can be lost if the browser profile is cleared. Claude will remind you of this when it matters.

Your app can also be started from a patient's Apps tab in the Tiro EHR. It then shows data of
that patient, fetched from the EHR for as long as the app is open. The app does not keep it.
Tiro and your clinic approve what an app may see before this works online.

## Made by

An open-source template by [Tiro.health](https://tiro.health), licensed under MIT.
