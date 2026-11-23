// What the eID check passes around. No patient data lives in this file.

/** The files asked from the card, base64, as BeIDConnect hands them over. */
export interface CardFiles {
  /** Identity file. */
  id: string
  /** Address file. */
  addr: string
  /** National Register signature over the identity file. */
  idsig: string
  /** National Register signature over the address file and the identity signature. */
  addrsig: string
  /** The National Register certificate the card carries. */
  rrncert: string
}

export const CARD_FILE_NAMES = [
  'id',
  'addr',
  'idsig',
  'addrsig',
  'rrncert',
] as const

export interface EidAddress {
  street: string
  zip: string
  municipality: string
}

/** The fields of the identity and address files this app uses. */
export interface EidCard {
  cardNumber: string
  nationalNumber: string
  surname: string
  /** At most two given names; the card holds no more. */
  firstNames: string
  thirdNameInitial: string
  nationality: string
  birthPlace: string
  /** As printed on the card, such as "21 AUG 1998". */
  birthDateText: string
  /** ISO date, or null when the text on the card is not a full date this app understands. */
  birthDate: string | null
  /** The card's own code: M, F, V or W. */
  genderCode: string
  gender: 'male' | 'female' | null
  documentType: string
  issuingMunicipality: string
  /** ISO dates, or null when unreadable. */
  validFrom: string | null
  validUntil: string | null
  address: EidAddress | null
}

export interface EidSignatures {
  /** The identity file carries a valid signature of the certificate on the card. */
  identity: boolean
  /** The same for the address file. */
  address: boolean
  /** Such as "RSA SHA-256"; null when no check could be done. */
  algorithm: string | null
  /** Common name of the certificate on the card. */
  signer: string | null
  /** The certificate's own validity period includes today. */
  signerValidToday: boolean
  /**
   * Always false in this prototype: the certificate on the card is not checked against the
   * Belgian root, nor for revocation. A forged card that brings its own certificate passes
   * the signature check.
   */
  chainChecked: false
}

export interface EidReading {
  card: EidCard
  signatures: EidSignatures
  /** The card's validity period includes today; null when the dates are unreadable. */
  validToday: boolean | null
}
