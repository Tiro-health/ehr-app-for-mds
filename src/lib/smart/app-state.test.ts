import {
  readState,
  writeState,
  valueExtensionUrl,
  type AppStateTarget,
} from './app-state'
import {
  APP_STATE,
  ISS,
  fakeEhr,
  launchedClient,
  testSettings,
} from './fake-ehr'

const system = 'https://my-app.tirohealth.app'

async function setup() {
  const settings = await testSettings()
  const ehr = fakeEhr(settings, { openid: true, appState: 'associated' })
  const client = await launchedClient(ehr, settings, 'p1')
  const target: AppStateTarget = {
    endpoint: client.appStateEndpoint!,
    fetch: (url, init) => client.fetch(url, init),
    system,
    subject: client.fhirUser!,
  }
  return { ehr, target }
}

function storedBasic(ehr: ReturnType<typeof fakeEhr>) {
  return [...ehr.resources.values()].find((r) => r.resourceType === 'Basic')!
}

test('creates, reads and updates state for the signed-in practitioner', async () => {
  const { ehr, target } = await setup()
  expect(target.endpoint).toBe(APP_STATE)
  expect(target.subject).toBe(`${ISS}/Practitioner/123`)
  expect(await readState(target, 'click-count')).toBeNull()

  const created = await writeState(target, 'click-count', 1, null)
  expect(created).toMatchObject({
    status: 'saved',
    state: { value: 1, version: '1' },
  })

  const stored = storedBasic(ehr)
  expect(stored.code).toEqual({
    coding: [{ system, code: 'click-count' }],
  })
  expect(stored.subject).toEqual({ reference: target.subject })
  expect(stored.extension).toEqual([
    { url: valueExtensionUrl(system), valueString: '1' },
  ])

  const read = await readState(target, 'click-count')
  expect(read).toMatchObject({ value: 1, version: '1' })

  const updated = await writeState(target, 'click-count', 2, read)
  expect(updated).toMatchObject({
    status: 'saved',
    state: { value: 2, version: '2' },
  })
})

test('a stale version is a conflict that returns the latest state', async () => {
  const { target } = await setup()
  const first = await writeState(target, 'notes', { text: 'a' }, null)
  if (first.status !== 'saved') throw new Error('expected saved')
  await writeState(target, 'notes', { text: 'b' }, first.state)

  const stale = await writeState(target, 'notes', { text: 'c' }, first.state)
  expect(stale).toMatchObject({
    status: 'conflict',
    state: { value: { text: 'b' } },
  })
})

test('state of another practitioner is not returned', async () => {
  const { target } = await setup()
  await writeState(target, 'click-count', 5, null)
  const other = { ...target, subject: `${ISS}/Practitioner/999` }
  expect(await readState(other, 'click-count')).toBeNull()
})

test('unreadable stored content is ignored, not thrown', async () => {
  const { ehr, target } = await setup()
  await writeState(target, 'click-count', 1, null)
  storedBasic(ehr).extension = [
    { url: valueExtensionUrl(system), valueString: '{not json' },
  ]
  expect(await readState(target, 'click-count')).toMatchObject({
    value: undefined,
  })
})

test('refuses state above the 256 KB limit', async () => {
  const { target } = await setup()
  await expect(
    writeState(target, 'big', 'x'.repeat(300 * 1024), null),
  ).rejects.toThrow('256 KB')
})

test('reads state back when the EHR returns the subject as a relative reference', async () => {
  // The Tiro EHR (HAPI) stores a reference to its own Practitioner as `Practitioner/<id>`.
  const settings = await testSettings()
  const ehr = fakeEhr(settings, { openid: true, appState: true })
  const client = await launchedClient(ehr, settings, 'p1')
  const target: AppStateTarget = {
    endpoint: client.appStateEndpoint!,
    fetch: (url, init) => client.fetch(url, init),
    system,
    subject: client.fhirUser!,
  }
  expect(target.endpoint).toBe(ISS)
  await writeState(target, 'click-count', 3, null)
  expect(storedBasic(ehr).subject).toEqual({ reference: 'Practitioner/123' })
  expect(await readState(target, 'click-count')).toMatchObject({ value: 3 })
})

test('a second create for the same state is a conflict that returns the stored state', async () => {
  const { target } = await setup()
  await writeState(target, 'notes', 'first', null)
  expect(await writeState(target, 'notes', 'second', null)).toMatchObject({
    status: 'conflict',
    state: { value: 'first' },
  })
})
