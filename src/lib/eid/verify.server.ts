import { X509Certificate, verify } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { photoHashLength } from '@/lib/eid/tlv'
import type { EidSignatures } from '@/lib/eid/types'

// Checks the National Register signatures on the identity and address files, the way the
// official eID Viewer does (eid_vwr_check_data_validity and verify_once in
// plugins_tools/eid-viewer/certhelpers.c of https://github.com/Fedict/eid-mw):
//
// - RSA key (applet 1.7): PKCS#1 v1.5. The hash is the one the card used for the photo hash
//   in the identity file: 20 bytes SHA-1, 32 bytes SHA-256, 48 bytes SHA-384. Cards that were
//   re-signed keep a SHA-1 photo hash but are signed with SHA-256, so that is tried too.
// - EC key (applet 1.8): ECDSA with SHA-384, the signature in ASN.1 DER. The signature file
//   can be longer than the signature, so it is cut to its DER length.
// - The identity signature covers the identity file as read.
// - The address signature covers the address file without its trailing zero bytes, followed
//   by the identity signature. (The card documentation says the zero bytes are kept; the
//   viewer's source notes that the documentation is wrong.)
//
// Not done here: checking that the certificate on the card was issued by the Belgian root,
// revocation, and the photo hash (the photo is not read). So a valid result means "signed by
// the certificate that came with the card", not "signed by the National Register".

export interface RawCardFiles {
  id: Uint8Array
  addr: Uint8Array
  idsig: Uint8Array
  addrsig: Uint8Array
}

const HASH_BY_LENGTH: Record<number, string[]> = {
  20: ['sha1', 'sha256'],
  32: ['sha256'],
  48: ['sha384'],
}

const HASH_NAME: Record<string, string> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
}

function withoutTrailingZeros(file: Uint8Array): Uint8Array {
  let end = file.length
  while (end > 0 && file[end - 1] === 0) end--
  return file.subarray(0, end)
}

/** Cuts an ASN.1 DER SEQUENCE to its own length; null when it is not one. */
export function derSequence(signature: Uint8Array): Uint8Array | null {
  if (signature.length < 2 || signature[0] !== 0x30) return null
  let length = signature[1]
  let header = 2
  if (length >= 0x80) {
    const lengthBytes = length & 0x7f
    if (lengthBytes === 0 || lengthBytes > 2) return null
    if (signature.length < 2 + lengthBytes) return null
    length = 0
    for (let i = 0; i < lengthBytes; i++) {
      length = (length << 8) | signature[2 + i]
    }
    header += lengthBytes
  }
  const total = header + length
  return total <= signature.length ? signature.subarray(0, total) : null
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a)
  joined.set(b, a.length)
  return joined
}

function check(
  hash: string,
  data: Uint8Array,
  key: KeyObject,
  signature: Uint8Array | null,
): boolean {
  if (!signature) return false
  try {
    return verify(hash, data, key, signature)
  } catch {
    // A malformed signature is an invalid signature.
    return false
  }
}

/** Whether the two signatures are valid for `key`, and with which algorithm. */
export function verifyCardSignatures(
  files: RawCardFiles,
  key: KeyObject,
): Pick<EidSignatures, 'identity' | 'address' | 'algorithm'> {
  const address = withoutTrailingZeros(files.addr)

  if (key.asymmetricKeyType === 'ec') {
    const idsig = derSequence(files.idsig)
    const identity = check('sha384', files.id, key, idsig)
    const addrsig = derSequence(files.addrsig)
    // The viewer appends the identity signature file as read. Where that file is longer than
    // the signature itself, the signature alone is accepted too: either way it is a valid
    // signature of the same key over this address.
    const signed = [files.idsig, ...(idsig ? [idsig] : [])]
    return {
      identity,
      address: signed.some((sig) =>
        check('sha384', concat(address, sig), key, addrsig),
      ),
      algorithm: 'ECDSA SHA-384',
    }
  }

  if (key.asymmetricKeyType === 'rsa') {
    let hashes: string[] = []
    try {
      hashes = HASH_BY_LENGTH[photoHashLength(files.id) ?? 0] ?? []
    } catch {
      // An unreadable identity file has no valid signature.
    }
    for (const hash of hashes) {
      if (!check(hash, files.id, key, files.idsig)) continue
      return {
        identity: true,
        address: check(hash, concat(address, files.idsig), key, files.addrsig),
        algorithm: `RSA ${HASH_NAME[hash]}`,
      }
    }
  }

  return { identity: false, address: false, algorithm: null }
}

/** The same, with the key taken from the certificate on the card (DER). */
export function verifyCard(
  files: RawCardFiles,
  certificate: Uint8Array,
  now: Date = new Date(),
): EidSignatures {
  let cert: X509Certificate
  try {
    cert = new X509Certificate(certificate)
  } catch {
    return {
      identity: false,
      address: false,
      algorithm: null,
      signer: null,
      signerValidToday: false,
      chainChecked: false,
    }
  }
  return {
    ...verifyCardSignatures(files, cert.publicKey),
    signer: /(?:^|\n)CN=(.*)/.exec(cert.subject)?.[1] ?? null,
    signerValidToday:
      new Date(cert.validFrom) <= now && now <= new Date(cert.validTo),
    chainChecked: false,
  }
}
