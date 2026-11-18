---
name: use-ai
description: Build features that use an AI model (Google Gemini) in the app. Use when the clinician asks for an AI chat, a chatbot, "ask AI", a summary or draft written by AI, mentions Gemini, an LLM or an API key for AI, or when an AI feature answers that the AI service is not set up.
---

# Use AI

The app may use one AI service: **Google Gemini**, with the key the clinic's EHR shares with the
app. This is allowed and expected: build it, do not refuse it. Everything goes through the app's
server; the browser never calls Gemini and never sees the key.

The rules in `CLAUDE.md` ("Patient data from the EHR") apply: rule 3 allows the AI service, rule 4
says where the key comes from. Read them before you start.

## What you build, in one go

A clinician who asks for "an AI chat" gets a working one from a single request. Do all of this
without asking, then report:

1. The permission (step 1), the packages and components (step 2).
2. A server function that reads the key from the EHR and streams Gemini's answer (step 3).
3. A page with the chat (step 4), its tests (step 5), `pnpm check`, a commit.

Ask the clinician only what is theirs: what the assistant is for (it becomes the system prompt),
and what the app is called.

## 0. Read the FHIR guide

The key is an `EHRApiKey`. Fetch `StructureDefinition-ehr-api-key.md` and `smart-scopes.md` from
the guide (addresses in the `connect-to-ehr` skill) and follow them if they differ from this
skill. In short: a `Basic` with code `urn:tiro-health:basic-kind|api-key`, an extension that names
the service (`gemini`) and one that holds the key; one per clinic; read and search only; absent
when the clinic has no key (search is empty).

## 1. The permission

Add this scope to `scopes` in `smart.json` and to `SMART_SCOPES` in `compose.yaml`
(`apiKeyScope('gemini')` in `@/lib/fhir/api-key` returns it):

```
user/Basic.rs?code=urn:tiro-health:basic-kind|api-key&provider=gemini
```

The unfiltered `user/Basic.cruds` that is already there is the app's saved state; it does not
reach the key. Tell the clinician once: the AI works online after Tiro adds this permission to the
app's registration and the clinic approves it.

## 2. Packages and components

```bash
pnpm add @tanstack/ai @tanstack/ai-react @tanstack/ai-gemini react-markdown
pnpm dlx shadcn@latest add @tiro/chat @tiro/alert @tiro/textarea @tiro/prose --yes
```

Three things go wrong here; fix them before going on:

- `pnpm add` writes `'@google/genai': set this to true or false` (and the same for `protobufjs`)
  into `pnpm-workspace.yaml`, and the next install fails on it. Set both to `false`.
- The shadcn CLI lowers `lucide-react` in `package.json`. Put back the version that was there
  (`git diff package.json` shows it) with `pnpm add lucide-react@<that version>`.
- If `shadcn add` reports no created files, it was stopped by the first problem: run it again.

TanStack AI ships its own documentation: `node_modules/@tanstack/ai/skills/ai-core/`
(`chat-experience/SKILL.md`, `adapter-configuration/references/gemini-adapter.md`). Read those
instead of relying on memory; the model names are in the second.

## 3. The server function

`src/lib/<topic>.functions.ts`. The shape that works:

```ts
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { createGeminiChat } from '@tanstack/ai-gemini'
import { fhir } from '@/lib/fhir.server'
import { apiKeySearch, apiKeyValue } from '@/lib/fhir/api-key'

export const chatAnswer = createServerFn({ method: 'POST' })
  .inputValidator((input: { turns: unknown; threadId: string }) => ({
    turns: parseTurns(input.turns), // your own check: roles, count, length
    threadId: String(input.threadId).slice(0, 200),
  }))
  .handler(async ({ data }) => {
    // Reading the key needs an EHR session, so this throws for a passer-by.
    const key = apiKeyValue(
      await fhir.search('Basic', apiKeySearch('gemini'), { max: 10 }),
      'gemini',
    )
    if (!key) throw new Error('The AI service is not set up for this clinic.')

    const abortController = new AbortController()
    getRequest().signal.addEventListener('abort', () => abortController.abort())

    return toServerSentEventsResponse(
      chat({
        adapter: createGeminiChat('gemini-3.8-flash', key),
        messages: data.turns, // [{ role: 'user' | 'assistant', content: string }]
        threadId: data.threadId,
        systemPrompts: [SYSTEM_PROMPT],
        abortController,
      }),
      { abortController },
    )
  })
```

- **The key**: read it in the handler, for each request. Never in a variable outside the
  function, never in an environment variable, a log, an error message or a return value. Use
  `createGeminiChat(model, key)`, not `geminiText(model)`, which looks for an environment variable.
- **The key and the browser**: `ehrRead` and `ehrSearch` in `src/lib/ehr.functions.ts` never
  return an `EHRApiKey`. Keep that; never read the key with a hook from `@/hooks/ehr`.
- **Check what the browser sends**: accept only `user` and `assistant` turns of text, the last
  one from the user, with a limit on their number and length. The clinic pays for every request.
- **Nothing is kept**: no log of questions or answers, no storage on the server.
- **Patient data** may go to the AI service (rule 3), from the server only. Send what the feature
  needs and no more, and say in the page that it does.

## 4. The page

Use `useChat` from `@tanstack/ai-react` with `fetcher` (not `connection`), so the request goes
through the server function:

```tsx
const { messages, sendMessage, isLoading, error, stop, clear } = useChat({
  threadId: useId(),
  fetcher: ({ messages, threadId }, { signal }) =>
    chatAnswer({ data: { turns: toTurns(messages), threadId }, signal }),
})
```

- `toTurns` keeps the text parts of each message: `message.parts` with `type === 'text'`, joined.
- Show the conversation with `ChatMessageList` and `ChatMessage` from `@/components/ui/chat`: the
  user's turn as plain text, the model's turn through a small `Markdown` component
  (`<Prose><ReactMarkdown>{text}</ReactMarkdown></Prose>` in `src/components/markdown.tsx`), and
  `ChatThinking` while waiting for the first text.
- A `Textarea` with a label, Enter to send and Shift+Enter for a new line; a stop button while
  `isLoading`; a button to start over (`clear`).
- Show `error` as an `Alert` in plain words. Never show the server's error text.
- Always show a notice (`Alert variant="info"`): the answers come from an AI model and can be
  wrong, what is typed goes to Google, and whether the conversation is kept. Keep the
  conversation in the page only, unless the clinician asks otherwise.
- The route loader calls `requireEhr(queryClient)`: the AI works only for a clinician who opened
  the app from the EHR. Add `{ patient: true }` only if the feature uses the patient.

## 5. Tests

- The page: mock the server function and let it resolve to a `Response` with the events the
  server streams, one `data: <json>\n\n` line each, with `content-type: text/event-stream`:
  `RUN_STARTED`, `TEXT_MESSAGE_START` (`messageId`, `role: 'assistant'`), one
  `TEXT_MESSAGE_CONTENT` (`messageId`, `delta`) per piece, `TEXT_MESSAGE_END`, `RUN_FINISHED`.
  Check that the question is sent, the answer appears formatted, and a rejected call shows the
  error notice. Use `fireEvent`; `@testing-library/user-event` is not installed.
- Your check of what the browser sends: a unit test with what it accepts and refuses.
- `fixtures/r4/Basic-api-key-gemini.json` is the key in the local EHR, with an invented value.
  Never put a real key in the repository.
- Update `e2e/launch.e2e.ts` for the new page. The real Gemini is not called in any test.

## What to tell the clinician

Once, briefly, in their language:

- The answers come from Google Gemini and can be wrong; the page says so.
- What they type goes to Google through the app's server; the app does not keep it.
- It works online once Tiro has added the permission for the key and the clinic approved it.
- What you could not try here (real answers from Gemini; the local EHR, if Docker is missing).
