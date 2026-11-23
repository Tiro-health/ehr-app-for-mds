import specimen from '../../../fixtures/eid/card-beidconnect-specimen.json'
import {
  CardFormatError,
  parseBirthDate,
  parseCard,
  parseCardDate,
  parseTlv,
  photoHashLength,
} from './tlv'

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))
const card = specimen.Readers[0]

test('reads the fields of the BeIDConnect specimen card', () => {
  expect(parseCard(bytes(card.id), bytes(card.addr))).toEqual({
    cardNumber: '000001014759',
    nationalNumber: '98082100029',
    surname: 'Specimen eID 18-75',
    firstNames: 'Alice Bert',
    thirdNameInitial: 'C',
    nationality: 'BELG',
    birthPlace: 'Leuven',
    birthDateText: '21 AUG 1998',
    birthDate: '1998-08-21',
    genderCode: 'V',
    gender: 'female',
    documentType: '1',
    issuingMunicipality: 'Leuven',
    validFrom: '2017-05-30',
    validUntil: '2027-05-30',
    address: {
      street: 'Specimenstraat 12',
      zip: '0000',
      municipality: 'Utopia',
    },
  })
})

test('the photo hash length tells which hash the card uses', () => {
  expect(photoHashLength(bytes(card.id))).toBe(32)
})

test('stops at the zero padding of a file', () => {
  const fields = parseTlv(bytes(card.addr))
  expect([...fields.keys()]).toEqual([1, 2, 3])
})

test('a length of 255 continues in the next byte', () => {
  const value = new Uint8Array(300).fill(0x41)
  const file = new Uint8Array([7, 0xff, 45, ...value, 8, 1, 0x42])
  const fields = parseTlv(file)
  expect(fields.get(7)).toHaveLength(300)
  expect(fields.get(8)).toEqual(new Uint8Array([0x42]))
})

test('keeps the two-byte structure version of newer cards (tag 0)', () => {
  const fields = parseTlv(new Uint8Array([0, 2, 0, 1, 6, 1, 0x31]))
  expect(fields.get(0)).toEqual(new Uint8Array([0, 1]))
  expect(fields.get(6)).toEqual(new Uint8Array([0x31]))
})

test('refuses a file that ends in the middle of a field, without quoting it', () => {
  const cut = bytes(card.id).subarray(0, 40)
  expect(() => parseTlv(cut)).toThrow(CardFormatError)
  try {
    parseCard(cut)
  } catch (error) {
    expect((error as Error).message).toBe(
      'The card data is not in the expected format.',
    )
  }
})

test('refuses an identity file without a national number', () => {
  expect(() => parseCard(new Uint8Array([7, 1, 0x41]))).toThrow(CardFormatError)
})

test.each([
  ['21 AUG 1998', '1998-08-21'],
  ['1 MARS 1960', '1960-03-01'],
  ['12 MAAR 1958', '1958-03-12'],
  ['03.MÄR.1971', '1971-03-03'],
  ['30 DEZ 2001', '2001-12-30'],
  ['05 SEPT 1949', '1949-09-05'],
  ['09 juil 1988', '1988-07-09'],
])('birth date %s is %s', (text, iso) => {
  expect(parseBirthDate(text)).toBe(iso)
})

test.each(['1958', '00 XXX 1958', '', '12 FOO 1958'])(
  'birth date "%s" is not a full date',
  (text) => {
    expect(parseBirthDate(text)).toBeNull()
  },
)

test('card dates', () => {
  expect(parseCardDate('30.05.2027')).toBe('2027-05-30')
  expect(parseCardDate('2027-05-30')).toBeNull()
})
