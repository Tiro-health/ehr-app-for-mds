import specimen from '../../../fixtures/eid/card-beidconnect-specimen.json'
import {
  beIdConnectSource,
  interpretAnswer,
  simulatedSource,
} from './card-source'

afterEach(() => {
  delete window.EIDChromeExt
  vi.useRealTimers()
})

/** Stands in for the object the BeIDConnect extension puts on the page. */
function installExtension(getId: (...args: unknown[]) => Promise<unknown>) {
  const calls: unknown[][] = []
  window.EIDChromeExt = class {
    getId(...args: unknown[]) {
      calls.push(args)
      return getId(...args)
    }
  }
  return calls
}

test('without the extension, the reader says so', async () => {
  expect(await beIdConnectSource().read()).toEqual({
    status: 'extension-missing',
  })
})

test('asks for identity, address and signatures, not the photo', async () => {
  const calls = installExtension(async () => specimen)
  const read = await beIdConnectSource().read()

  expect(calls).toEqual([['en', '0'.repeat(32), 1 | 2 | 8]])
  expect(read.status).toBe('ok')
  if (read.status !== 'ok') return
  expect(read.cards).toBe(1)
  expect(Object.keys(read.files).sort()).toEqual([
    'addr',
    'addrsig',
    'id',
    'idsig',
    'rrncert',
  ])
  expect(read.files.id).toBe(specimen.Readers[0].id)
})

test.each([
  [{ result: 'no_reader' }, { status: 'no-reader' }],
  [
    { result: 'no_card', Readers: [] },
    { status: 'no-card', unsupported: false },
  ],
  [
    { result: 'no_card', report: 'card_type_unsupported' },
    { status: 'no-card', unsupported: true },
  ],
  [{ result: 'busy' }, { status: 'busy' }],
  // The extension's own answer when the program on the computer is not installed.
  [{ result: 'timeout', extensionError: 'x' }, { status: 'host-missing' }],
  [{ result: 'general_error' }, { status: 'error', code: 'general_error' }],
  [{ result: 'technical_error' }, { status: 'error', code: 'technical_error' }],
])('the extension rejecting with %j gives %j', async (rejection, expected) => {
  installExtension(async () => {
    throw rejection
  })
  expect(await beIdConnectSource().read()).toEqual(expected)
})

test('gives up on an extension that never answers', async () => {
  vi.useFakeTimers()
  installExtension(() => new Promise(() => {}))
  const reading = beIdConnectSource(5000).read()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await reading).toEqual({ status: 'timeout' })
})

test('an unexpected result is never passed on as it is', () => {
  expect(interpretAnswer({ result: 'Jeanne Voorbeeld <script>' })).toEqual({
    status: 'error',
    code: 'unknown',
  })
  expect(interpretAnswer(undefined)).toEqual({
    status: 'error',
    code: 'no_answer',
  })
})

test('a reader without all the files counts as no card', () => {
  const incomplete = { ...specimen.Readers[0], idsig: '' }
  expect(interpretAnswer({ result: 'OK', Readers: [incomplete] })).toEqual({
    status: 'no-card',
    unsupported: false,
  })
})

test('with two cards, the first is used and the count is given', () => {
  const answer = {
    result: 'OK',
    Readers: [specimen.Readers[0], specimen.Readers[0]],
  }
  expect(interpretAnswer(answer)).toMatchObject({ status: 'ok', cards: 2 })
})

test('a simulated source answers like the extension would', async () => {
  const source = simulatedSource('test', 'Test card', specimen)
  expect(source.simulated).toBe(true)
  expect(await source.read()).toMatchObject({ status: 'ok', cards: 1 })
})
