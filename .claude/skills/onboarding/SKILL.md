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

Two things only the clinician can do are needed before the app can go online: installing Tiro's
publishing app on the repository, and Tiro approving the app's web address. Approval is done by
hand and takes time, so start both now and let them run while you build.

1. **Install Tiro Deploy.** Explain in one sentence that it is the app that puts their tool
   online. Ask them to open https://github.com/apps/tiro-health-deploy/installations/new, choose
   the account that owns this repository, pick **Only select repositories**, select this
   repository and click **Install**. Wait until they confirm; you cannot check it for them.
2. **Choose the web address.** Propose `https://<name>.tirohealth.app`, with `<name>` taken from
   the app's name: 3 to 20 characters, lowercase letters, digits and hyphens, starting with a
   letter and not ending with a hyphen. Let them change it.
3. **Ask Tiro for it.** Get the repository id with `gh api repos/<owner>/<repo> --jq .id` and
   give the clinician this message to send to their contact at Tiro, filled in:

   > Please approve my app for tirohealth.app.
   > Repository: `<owner>/<repo>` (id `<id>`)
   > Requested address: `https://<name>.tirohealth.app`

   Tell them that once Tiro approves it, publishing puts the app online at that address, and
   that you can keep building in the meantime.

## 4. Patient data, said once

If the tool will record anything about real patients, say this once, in your own words, briefly:
the app stores data only in the browser on this device, nothing leaves it, and clearing the browser
loses it. Ask if that is acceptable for a first version. If not, suggest starting with example or
anonymous data.

## 5. Set the app up

- Put the name and a one-line tagline in `src/app.config.ts` and the `<title>` in `index.html`.
- Build the first version of the tool as a page under `src/pages/` with a route in `src/routes/`,
  following `CLAUDE.md`. Replace the example content on the home page with the tool itself, or
  make the home page an index if there will clearly be several tools.
- Write the page test. For any clinical score or formula, add unit tests with reference values
  and cite the source in a comment.
- Run `pnpm check` and fix everything it reports.
- Start `pnpm dev` and tell the clinician to open http://localhost:3000 if they are running
  locally. Ask for one round of feedback and apply it.

## 6. Commit and publish

- Commit with a message like `Set up <app name>`.
- Invoke the `publish` skill. If Tiro has not approved the web address yet, the app goes online
  on the first publish after approval; say so rather than treating it as an error. Explain that
  after that, every change gets published the same way when you push it.

## 7. Close

Finish with three example requests they could make next, tailored to their tool. Nothing else.
