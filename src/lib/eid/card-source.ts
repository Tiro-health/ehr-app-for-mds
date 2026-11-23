import { CARD_FILE_NAMES } from '@/lib/eid/types'
import type { CardFiles } from '@/lib/eid/types'

// Where the card comes from. The page only knows `CardSource`, so a test or the local preview
// can put a simulated card in the place of a real reader.
//
// The real source is BOSA's BeIDConnect (https://github.com/Fedict/fts-beidconnect): a browser
// extension and a program on the computer. The extension puts `window.EIDChromeExt` on every
// page (ChromeExtension/src_v3/main/page.js); `new EIDChromeExt().getId(language, mac, idflags)`
// answers with the card files in base64. Browser only: never call a source while rendering.

/** What to ask from the card (common/general.h): identity, address and their signatures. */
export const ID_FLAGS = { id: 1, address: 2, photo: 4, integrity: 8 } as const
const WANTED = ID_FLAGS.id | ID_FLAGS.address | ID_FLAGS.integrity

export type CardRead =
  | { status: 'ok'; files: CardFiles; cards: number }
  | { status: 'extension-missing' }
  | { status: 'host-missing' }
  | { status: 'no-reader' }
  | { status: 'no-card'; unsupported: boolean }
  | { status: 'busy' }
  | { status: 'timeout' }
  /** `code` is BeIDConnect's own result word, such as `general_error`; never card content. */
  | { status: 'error'; code: string }

export interface CardSource {
  id: string
  label: string
  /** True for a card that is not read from a reader. */
  simulated: boolean
  read: () => Promise<CardRead>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Turns BeIDConnect's answer (or the error it rejected with: same shape) into a `CardRead`.
 * `result` values are in common/comm.hpp: "OK", "no_reader", "no_card", "busy",
 * "general_error", ...; the extension itself adds "timeout" (the program on the computer is
 * not installed) and "technical_error".
 */
export function interpretAnswer(answer: unknown): CardRead {
  if (!isRecord(answer)) return { status: 'error', code: 'no_answer' }
  const result = answer.result
  if (result === 'no_reader') return { status: 'no-reader' }
  if (result === 'no_card') {
    return {
      status: 'no-card',
      unsupported: answer.report === 'card_type_unsupported',
    }
  }
  if (result === 'busy') return { status: 'busy' }
  if (result === 'timeout') return { status: 'host-missing' }
  if (result !== 'OK') {
    const code =
      typeof result === 'string' && /^[a-z0-9_]{1,40}$/i.test(result)
        ? result
        : 'unknown'
    return { status: 'error', code }
  }

  const readers = Array.isArray(answer.Readers) ? answer.Readers : []
  const cards = readers.filter(isRecord).flatMap((reader) => {
    const files = {} as CardFiles
    for (const name of CARD_FILE_NAMES) {
      const file = reader[name]
      if (typeof file !== 'string' || file === '') return []
      files[name] = file
    }
    return [files]
  })
  if (cards.length === 0) return { status: 'no-card', unsupported: false }
  return { status: 'ok', files: cards[0], cards: cards.length }
}

interface BeIdConnect {
  getId: (language: string, mac: string, idflags: number) => Promise<unknown>
}

declare global {
  interface Window {
    EIDChromeExt?: new () => BeIdConnect
  }
}

/** Reading the files takes about a second; a reader that never answers is given up on. */
const ANSWER_TIMEOUT_MS = 30_000

/** A real card, in a reader, through the BeIDConnect extension of this browser. */
export function beIdConnectSource(
  timeoutMs: number = ANSWER_TIMEOUT_MS,
): CardSource {
  return {
    id: 'beidconnect',
    label: 'Card reader (BeIDConnect)',
    simulated: false,
    read: async () => {
      if (typeof window.EIDChromeExt !== 'function') {
        return { status: 'extension-missing' }
      }
      const extension = new window.EIDChromeExt()
      // `mac` is passed on to the program on the computer, which never reads it for any
      // operation (see the report in the pull request). A fixed filler, as in BOSA's test page.
      const mac = '0'.repeat(32)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const answer = await Promise.race([
          // The extension rejects with the answer itself when `result` is not "OK".
          extension.getId('en', mac, WANTED).catch((error: unknown) => error),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs)
          }),
        ])
        if (answer === 'timeout') return { status: 'timeout' }
        return interpretAnswer(answer)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** A card that is not in a reader: a stored BeIDConnect answer with invented data. */
export function simulatedSource(
  id: string,
  label: string,
  answer: unknown,
): CardSource {
  return {
    id,
    label,
    simulated: true,
    read: async () => interpretAnswer(answer),
  }
}
