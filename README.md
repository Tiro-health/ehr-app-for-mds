# Build your own clinical tool with Claude Code

Describe a small tool (a score calculator, a checklist, a protocol lookup) and Claude Code
builds and publishes it for you. You need a [GitHub](https://github.com) account and
[Claude Code](https://claude.com/claude-code), as the desktop app or on the web.

> Do not enter real patient data until Tiro has approved your app.

## Start

1. [**Create your repository from this template**](https://github.com/new?template_owner=Tiro-health&template_name=ehr-app-for-mds&owner=%40me&name=my-clinical-app&description=My+clinical+tool%2C+built+with+Claude+Code&visibility=public).
2. Open the repository in Claude Code.
   - Web: go to [claude.ai/code](https://claude.ai/code), connect GitHub and pick the repository.
   - Desktop: open Claude Code, then add the repository from GitHub.
3. Type `/onboarding` and answer Claude's questions.

Claude builds a first version. To put it online, Tiro registers your app and gives it an
address on tirohealth.app. Claude tells you what to do and when to wait.

## What you can ask

- "Add a page with the CHA2DS2-VASc score."
- "Show the last three encounters of the patient I have open in the EHR."
- "Publish the latest version."

If something fails, paste the error into Claude Code and ask it to fix it.

## Your data

Data you type is saved only in your browser, on that device. It is lost if you clear the
browser data. Opened from a patient's Apps tab in the Tiro EHR, the app shows that patient's
data while it is open and does not keep it.

<details>
<summary>For developers</summary>

- Local EHR with invented data: `docker compose up -d`, then `pnpm dev` (app at
  http://127.0.0.1:3000). Requires Docker. Claude starts it during `/onboarding`.
- Debug scenarios, architecture and conventions: [CLAUDE.md](CLAUDE.md).
- Linking the repository: after registration, link it on the EHR setup page at
  https://ehr.tiro.health/platform/setup. Until then, changes are checked and built but not
  published.

</details>

## Made by

An open-source template by [Tiro.health](https://tiro.health), licensed under MIT.
