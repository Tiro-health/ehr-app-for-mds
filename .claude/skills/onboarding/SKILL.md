---
name: onboarding
description: Start here in a fresh repository created from the template. Conversationally settles what the app is, sets it up, and publishes it. Use when the clinician runs /onboarding, says they are new, or the app still carries the template name "My clinical app".
---

# Onboarding

You are guiding a clinician, probably with no programming experience, from an untouched template
to a published app with their name on it. One conversation, one live URL at the end.

Speak plainly. One question at a time. Never ask two things in one message.

## 1. Check the environment (silently where possible)

Run these and fix what is missing before involving the clinician:

- `node -v` (need 22 or newer) and `pnpm -v`. If Node is missing, install it with the
  official installer for the platform or `fnm`, then `corepack enable pnpm`. Tell the clinician
  in one sentence that you are installing a tool the app needs.
- `pnpm install` if `node_modules/` is absent.
- `git remote -v` to learn the GitHub owner and repository name. Note them for the publish step.
- `gh auth status`. Publishing needs `gh`. If it is missing or not logged in, install it and run
  `gh auth login` with the clinician, explaining in one sentence that it lets you publish for them.

If `src/app.config.ts` already has a name other than "My clinical app", this repo has been
onboarded before. Say so, ask whether they want to change the app or add something to it, and
continue from step 5.

## 2. Learn what they want to build

Ask, in this order, one message each:

1. **What should the tool do?** Encourage a concrete first version: "the smallest thing that would
   already be useful to you tomorrow". Reflect it back in one sentence and confirm.
2. **What is it called?** Suggest two or three names based on the answer. Short, no jargon.
3. **Who will use it and in which language?** Default the UI language to the language the
   clinician is writing in.

Do not ask about colours, fonts or layout. Pick calm, clinical defaults. They can change them later.

## 3. Get the web address started

First check whether that is already done: `gh variable get TIRO_EHR_APP_NAME`. A clinician who
started from a setup link Tiro sent them (`https://ehr.tiro.health/platform/setup/<name>`) has
already created this repository from that page, installed the Tiro.health GitHub App and linked
the repository. The variable then holds the app's name. Tell them in one sentence that their
address is `https://<name>.tirohealth.app`, skip the rest of this section, and go to step 4.

If the variable is empty, the app needs a web address, and Tiro registers every address by hand.
Start now and let it run while you build.

1. **Install the Tiro.health GitHub App.** Explain in one sentence that it is the app that lets
   Tiro put their tool online. Ask them to open
   https://github.com/apps/tiro-health-deploy/installations/new, choose the account that owns this
   repository, pick **Only select repositories**, select this repository and click **Install**.
   Wait until they confirm; you cannot check it for them.
2. **Choose the web address.** Propose `https://<name>.tirohealth.app`, with `<name>` taken from
   the app's name: 3 to 20 characters, lowercase letters, digits and hyphens, starting with a
   letter and not ending with a hyphen. Let them change it.
3. **Ask Tiro for it.** Ask the clinician two things, one message each: does the tool read or file
   data of the patient open in the EHR (from step 4's answer, if already known), and, if the
   repository belongs to an organisation, will they link it themselves on the setup page or does an
   organisation admin. Tell them you are filing the request, and that it is public, so it contains
   nothing about patients. Open the request on Tiro's side:

   ```bash
   gh issue create --repo Tiro-health/ehr-app-build \
     --title "Register app: <name>" --body "### Repository

   <owner>/<repo>

   ### Repository id

   <id from: gh api repos/<owner>/<repo> --jq .id>

   ### Web address name

   <name>

   ### What does the app do?

   <one or two sentences from step 2: what it does and who uses it>

   Needs data of the patient open in the EHR (SMART client): <yes or no>
   Linked on the setup page by: <GitHub login of the person who will link it>

   ### GitHub App

   - [X] I installed the Tiro.health GitHub App on this repository."
   ```

   Within a minute a check comments on it. If it asks for a change (for example, the name is
   taken), agree a new name with the clinician and fix it with `gh issue edit <number> --body …`.
   Once it says the request is complete, tell the clinician Tiro approves it by hand, and that you
   can keep building in the meantime. Note the issue URL for the publish step.

### Then, either way: link the repository

Once Tiro has registered the app, the clinician links this repository on the EHR's setup page
(https://ehr.tiro.health/platform/setup). The page is in Dutch: they sign in with GitHub, pick the
app and the repository, and press "Koppelen". It only accepts a repository of the GitHub owner the
app was registered for, from an administrator of that repository. Tiro.health then sets the repository variable
`TIRO_EHR_APP_NAME` and starts the first publish; no file changes (step 0 of `publish`). Until
then, pushes to `main` are checked and built, and the publish job passes with a "Not published"
notice.

## 4. Patient data, said once

There are two kinds, and the answer to "what should the tool do?" tells you which applies.

- **The tool needs the patient from the EHR** (it shows or uses the record of the patient the
  clinician has open, their encounters or documents, or files something in the record): read
  the `connect-to-ehr` skill now and build the tool as it describes. Say once, briefly: the
  clinician starts the app from the patient's Apps tab in the Tiro EHR, the app shows that
  patient's data without keeping it, and Tiro and the clinic approve what the app may see
  before it works online. Until then they see an invented patient in the preview.
- **The clinician types patient data into the tool**: say once, in your own words, briefly:
  the app stores that data only in the browser on this device, nothing leaves it, and clearing
  the browser loses it. Ask if that is acceptable for a first version. If not, suggest starting
  with example or anonymous data.
- **No patient data** (a calculator, a reference): say nothing about it.

## 5. Set the app up

- Put the name and a one-line tagline in `src/app.config.ts` (the page title follows the name).
- Build the first version of the tool as a page under `src/pages/` with a route in `src/routes/`,
  following `CLAUDE.md`. Replace the example content on the home page with the tool itself, or
  make the home page an index if there will clearly be several tools.
- Write the page test. For any clinical score or formula, add unit tests with reference values
  and cite the source in a comment.
- Run `pnpm check` and fix everything it reports.
- Start the local EHR with `docker compose up -d` (Docker must be installed; if it is not, help
  the clinician install Docker Desktop, or skip the EHR and say the app then shows no patient),
  then `pnpm dev`, and tell the clinician to open http://127.0.0.1:3000 if they are running
  locally. It shows the app as opened from the EHR for an invented patient; the other
  situations (no patient, refused access, session ended) are at http://localhost:8080/_dev.
  Ask for one round of feedback and apply it.

## 6. Commit and publish

- Commit with a message like `Set up <app name>`.
- Invoke the `publish` skill. If Tiro has not approved the web address yet, the app goes online
  on the first publish after approval; say so rather than treating it as an error. Explain that
  after that, every change gets published the same way when you push it.

## 7. Close

Finish with three example requests they could make next, tailored to their tool. Nothing else.
