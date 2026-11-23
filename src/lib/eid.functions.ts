import { createServerFn } from '@tanstack/react-start'
import { fhir } from '@/lib/fhir.server'
import { fromEhr } from '@/lib/fhir/from-ehr'
import { parseCard } from '@/lib/eid/tlv'
import { CARD_FILE_NAMES } from '@/lib/eid/types'
import type { CardFiles, EidReading } from '@/lib/eid/types'
import { verifyCard } from '@/lib/eid/verify.server'

// The eID check on the server: the browser sends the files it read from the card, the server
// checks the signatures and reads the fields, and sends the result back.
//
// The files are a person's identity data. The rules of CLAUDE.md apply as for patient data:
// nothing is logged, nothing is kept after the answer, nothing goes to another service, and
// no error message carries a value from the card.

// The largest file, the certificate, is about 1.3 kB; base64 adds a third.
const MAX_BASE64 = 8192

const fail = (): never => {
  throw new TypeError('Not a valid request.')
}

function base64(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return fail()
  }
  return value
}

/** Checks the signatures of an eID card's files and reads its fields. Stores nothing. */
export const eidVerify = createServerFn({ method: 'POST' })
  .inputValidator((input: CardFiles): CardFiles => {
    if (typeof input !== 'object' || input === null) return fail()
    const files = {} as CardFiles
    for (const name of CARD_FILE_NAMES) files[name] = base64(input[name])
    return files
  })
  .handler(({ data }) =>
    fromEhr(async (): Promise<EidReading> => {
      // Only for a clinician who opened the app from the EHR.
      await fhir.context()

      const bytes = (name: keyof CardFiles) =>
        new Uint8Array(Buffer.from(data[name], 'base64'))
      const files = {
        id: bytes('id'),
        addr: bytes('addr'),
        idsig: bytes('idsig'),
        addrsig: bytes('addrsig'),
      }
      const now = new Date()
      const card = parseCard(files.id, files.addr)
      const today = now.toISOString().slice(0, 10)
      return {
        card,
        signatures: verifyCard(files, bytes('rrncert'), now),
        validToday:
          card.validFrom && card.validUntil
            ? card.validFrom <= today && today <= card.validUntil
            : null,
      }
    }),
  )
