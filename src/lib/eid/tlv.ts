import type { EidAddress, EidCard } from '@/lib/eid/types'

// The identity and address files of a Belgian eID card are a list of tag, length, value.
// Format and tags: "ID and Address file contents" (ID_ADRESSE_File_applet1_8_v5.pdf) and
// beidsdk_card_data.pdf in https://github.com/Fedict/eid-mw, doc/sdk/documentation.
// Applet 1.7 cards use the same tags, with a 20 or 32 byte photo hash instead of 48.

export class CardFormatError extends Error {
  constructor() {
    // Never put file content in the message: it is patient data.
    super('The card data is not in the expected format.')
    this.name = 'CardFormatError'
  }
}

/**
 * Splits a card file into its fields by tag. A length of 255 continues in the next byte.
 * Files are padded with zero bytes: an empty tag 0 ends the list.
 */
export function parseTlv(file: Uint8Array): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>()
  let at = 0
  while (at < file.length) {
    const tag = file[at++]
    let length = 0
    let byte: number
    do {
      if (at >= file.length) {
        if (tag === 0) return fields
        throw new CardFormatError()
      }
      byte = file[at++]
      length += byte
    } while (byte === 0xff)
    if (tag === 0 && length === 0) return fields
    if (at + length > file.length) throw new CardFormatError()
    fields.set(tag, file.subarray(at, at + length))
    at += length
  }
  return fields
}

const utf8 = new TextDecoder('utf-8')
const text = (fields: Map<number, Uint8Array>, tag: number) =>
  utf8.decode(fields.get(tag) ?? new Uint8Array()).trim()

// Month abbreviations per card language (the format document, "Birth date month encoding").
const MONTHS: Record<string, number> = {
  JAN: 1,
  FEV: 2,
  FEB: 2,
  MARS: 3,
  MAAR: 3,
  MÄR: 3,
  AVR: 4,
  APR: 4,
  MAI: 5,
  MEI: 5,
  JUIN: 6,
  JUN: 6,
  JUIL: 7,
  JUL: 7,
  AOUT: 8,
  AUG: 8,
  SEPT: 9,
  SEP: 9,
  OCT: 10,
  OKT: 10,
  NOV: 11,
  DEC: 12,
  DEZ: 12,
}

const iso = (year: string, month: number, day: string) =>
  `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`

/** "21 AUG 1998" or "21.AUG.1998" (German) to "1998-08-21"; null for anything else. */
export function parseBirthDate(value: string): string | null {
  const match = /^(\d{1,2})[ .]+(\p{L}+)[ .]+(\d{4})$/u.exec(value.trim())
  if (!match) return null
  const month = MONTHS[match[2].toUpperCase()]
  const day = Number(match[1])
  if (!month || day < 1 || day > 31) return null
  return iso(match[3], month, match[1])
}

/** "30.05.2017" to "2017-05-30". */
export function parseCardDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  return match ? iso(match[3], Number(match[2]), match[1]) : null
}

/** The length in bytes of the photo hash in the identity file: it tells which hash the card uses. */
export function photoHashLength(identityFile: Uint8Array): number | null {
  return parseTlv(identityFile).get(17)?.length ?? null
}

function gender(code: string): EidCard['gender'] {
  if (code === 'M') return 'male'
  // F, V and W: woman in French, Dutch and German.
  if (code === 'F' || code === 'V' || code === 'W') return 'female'
  return null
}

function parseAddress(file: Uint8Array): EidAddress | null {
  const fields = parseTlv(file)
  const address = {
    street: text(fields, 1),
    zip: text(fields, 2),
    municipality: text(fields, 3),
  }
  return address.street || address.zip || address.municipality ? address : null
}

/** The fields this app uses, from the identity file and (when given) the address file. */
export function parseCard(
  identityFile: Uint8Array,
  addressFile?: Uint8Array,
): EidCard {
  const fields = parseTlv(identityFile)
  const nationalNumber = text(fields, 6)
  if (!/^\d{11}$/.test(nationalNumber)) throw new CardFormatError()
  const birthDateText = text(fields, 12)
  const genderCode = text(fields, 13).toUpperCase()
  return {
    cardNumber: text(fields, 1),
    nationalNumber,
    surname: text(fields, 7),
    firstNames: text(fields, 8),
    thirdNameInitial: text(fields, 9),
    nationality: text(fields, 10),
    birthPlace: text(fields, 11),
    birthDateText,
    birthDate: parseBirthDate(birthDateText),
    genderCode,
    gender: gender(genderCode),
    documentType: text(fields, 15),
    issuingMunicipality: text(fields, 5),
    validFrom: parseCardDate(text(fields, 3)),
    validUntil: parseCardDate(text(fields, 4)),
    address: addressFile ? parseAddress(addressFile) : null,
  }
}
