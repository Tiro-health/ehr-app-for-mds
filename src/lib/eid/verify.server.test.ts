// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import matching from '../../../fixtures/eid/card-matching-patient-1.json'
import specimen from '../../../fixtures/eid/card-beidconnect-specimen.json'
import { derSequence, verifyCard, verifyCardSignatures } from './verify.server'

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))
const filesOf = (card: (typeof specimen.Readers)[0]) => ({
  id: bytes(card.id),
  addr: bytes(card.addr),
  idsig: bytes(card.idsig),
  addrsig: bytes(card.addrsig),
})
const card = specimen.Readers[0]
const NOW = new Date('2026-11-23T12:00:00Z')

const flipped = (file: Uint8Array, at: number) => {
  const copy = new Uint8Array(file)
  copy[at] ^= 0x01
  return copy
}

test('the BeIDConnect specimen card carries valid signatures of its test certificate', () => {
  expect(verifyCard(filesOf(card), bytes(card.rrncert), NOW)).toEqual({
    identity: true,
    address: true,
    algorithm: 'RSA SHA-256',
    signer: 'eID TEST RRN',
    signerValidToday: true,
    chainChecked: false,
  })
})

test('the invented card for patient-1 verifies against its own invented certificate', () => {
  const made = matching.Readers[0]
  const result = verifyCard(filesOf(made), bytes(made.rrncert), NOW)
  expect(result).toMatchObject({ identity: true, address: true })
  // Which is why a valid signature alone proves nothing about where the card comes from.
  expect(result.signer).toContain('not the National Register')
  expect(result.chainChecked).toBe(false)
})

test('a changed identity file fails both signatures', () => {
  const files = { ...filesOf(card), id: flipped(bytes(card.id), 60) }
  expect(verifyCard(files, bytes(card.rrncert), NOW)).toMatchObject({
    identity: false,
    address: false,
    algorithm: null,
  })
})

test('a changed address fails the address signature only', () => {
  const files = { ...filesOf(card), addr: flipped(bytes(card.addr), 5) }
  expect(verifyCard(files, bytes(card.rrncert), NOW)).toMatchObject({
    identity: true,
    address: false,
  })
})

test('the address signature does not cover the zero padding of the address file', () => {
  const addr = bytes(card.addr)
  let end = addr.length
  while (addr[end - 1] === 0) end--
  expect(end).toBeLessThan(addr.length)
  const files = { ...filesOf(card), addr: addr.subarray(0, end) }
  expect(verifyCard(files, bytes(card.rrncert), NOW).address).toBe(true)
})

test('an identity signature swapped for another valid one fails the address signature', () => {
  const other = matching.Readers[0]
  const files = { ...filesOf(card), idsig: bytes(other.idsig) }
  expect(verifyCard(files, bytes(card.rrncert), NOW)).toMatchObject({
    identity: false,
    address: false,
  })
})

test('a certificate of another signer fails', () => {
  const other = matching.Readers[0]
  expect(verifyCard(filesOf(card), bytes(other.rrncert), NOW)).toMatchObject({
    identity: false,
    address: false,
  })
})

test('something that is not a certificate fails without throwing', () => {
  expect(verifyCard(filesOf(card), new Uint8Array([1, 2, 3]), NOW)).toEqual({
    identity: false,
    address: false,
    algorithm: null,
    signer: null,
    signerValidToday: false,
    chainChecked: false,
  })
})

test('reports a certificate outside its validity period', () => {
  const later = new Date('2060-01-01T00:00:00Z')
  expect(
    verifyCard(filesOf(card), bytes(card.rrncert), later).signerValidToday,
  ).toBe(false)
})

// Applet 1.8 cards: no real or specimen files of such a card are available, so the files are
// made here with a fresh key, following the scheme of the eID Viewer source.
describe('ECDSA SHA-384 (applet 1.8)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp384r1',
  })
  const id = bytes(card.id)
  const addr = bytes(card.addr)
  const padded = (signature: Uint8Array) => {
    const file = new Uint8Array(120)
    file.set(signature)
    return file
  }
  const trimmedAddr = addr.subarray(0, addr.indexOf(0))
  const idsig = new Uint8Array(sign('sha384', id, privateKey))

  test('verifies, with signature files longer than the signatures', () => {
    const idsigFile = padded(idsig)
    const addrsig = sign(
      'sha384',
      Buffer.concat([trimmedAddr, idsigFile]),
      privateKey,
    )
    expect(
      verifyCardSignatures(
        { id, addr, idsig: idsigFile, addrsig: padded(addrsig) },
        publicKey,
      ),
    ).toEqual({ identity: true, address: true, algorithm: 'ECDSA SHA-384' })
  })

  test('verifies when the address signature covers the identity signature alone', () => {
    const addrsig = sign(
      'sha384',
      Buffer.concat([trimmedAddr, idsig]),
      privateKey,
    )
    expect(
      verifyCardSignatures(
        { id, addr, idsig: padded(idsig), addrsig: new Uint8Array(addrsig) },
        publicKey,
      ),
    ).toMatchObject({ identity: true, address: true })
  })

  test('a changed identity file fails', () => {
    const addrsig = sign(
      'sha384',
      Buffer.concat([trimmedAddr, idsig]),
      privateKey,
    )
    expect(
      verifyCardSignatures(
        { id: flipped(id, 60), addr, idsig, addrsig: new Uint8Array(addrsig) },
        publicKey,
      ),
    ).toMatchObject({ identity: false, address: true })
  })

  test('a signature that is not ASN.1 fails without throwing', () => {
    expect(
      verifyCardSignatures(
        { id, addr, idsig: new Uint8Array(96), addrsig: new Uint8Array(96) },
        publicKey,
      ),
    ).toMatchObject({ identity: false, address: false })
  })
})

test('cuts a DER sequence to its own length', () => {
  expect(derSequence(new Uint8Array([0x30, 2, 1, 2, 0, 0]))).toEqual(
    new Uint8Array([0x30, 2, 1, 2]),
  )
  expect(derSequence(new Uint8Array([0x30, 0x81, 1, 9, 0]))).toEqual(
    new Uint8Array([0x30, 0x81, 1, 9]),
  )
  expect(derSequence(new Uint8Array([0x30, 9, 1]))).toBeNull()
  expect(derSequence(new Uint8Array([0x31, 0]))).toBeNull()
  expect(derSequence(new Uint8Array([0x30, 0x85, 1, 2, 3]))).toBeNull()
})
