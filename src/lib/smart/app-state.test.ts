import {
  readState,
  writeState,
  valueExtensionUrl,
  type AppStateTarget,
} from './app-state'
import { APP_STATE, fakeEhr } from './fake-ehr'

const target: AppStateTarget = {
  endpoint: APP_STATE,
  accessToken: 'token',
  system: 'https://my-app.tirohealth.app',
  subject: 'https://ehr.example.org/fhir/Practitioner/123',
}

test('creates, reads and updates state for the signed-in practitioner', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  expect(await readState(target, 'click-count', ehr.fetch)).toBeNull()

  const created = await writeState(target, 'click-count', 1, null, ehr.fetch)
  expect(created).toMatchObject({
    status: 'saved',
    state: { value: 1, version: 'a' },
  })

  const stored = [...ehr.store.values()][0]
  expect(stored.code.coding).toEqual([
    { system: 'https://my-app.tirohealth.app', code: 'click-count' },
  ])
  expect(stored.subject).toEqual({ reference: target.subject })
  expect(stored.extension).toEqual([
    { url: valueExtensionUrl(target.system), valueString: '1' },
  ])

  const read = await readState(target, 'click-count', ehr.fetch)
  expect(read).toMatchObject({ value: 1, version: 'a' })

  const updated = await writeState(target, 'click-count', 2, read, ehr.fetch)
  expect(updated).toMatchObject({
    status: 'saved',
    state: { value: 2, version: 'b' },
  })
})

test('a stale version is a conflict that returns the latest state', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  const first = await writeState(
    target,
    'notes',
    { text: 'a' },
    null,
    ehr.fetch,
  )
  if (first.status !== 'saved') throw new Error('expected saved')
  await writeState(target, 'notes', { text: 'b' }, first.state, ehr.fetch)

  const stale = await writeState(
    target,
    'notes',
    { text: 'c' },
    first.state,
    ehr.fetch,
  )
  expect(stale).toMatchObject({
    status: 'conflict',
    state: { value: { text: 'b' } },
  })
})

test('state of another practitioner is not returned', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  await writeState(target, 'click-count', 5, null, ehr.fetch)
  const other = {
    ...target,
    subject: 'https://ehr.example.org/fhir/Practitioner/999',
  }
  expect(await readState(other, 'click-count', ehr.fetch)).toBeNull()
})

test('unreadable stored content is ignored, not thrown', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  await writeState(target, 'click-count', 1, null, ehr.fetch)
  const stored = [...ehr.store.values()][0]
  stored.extension = [
    { url: valueExtensionUrl(target.system), valueString: '{not json' },
  ]
  expect(await readState(target, 'click-count', ehr.fetch)).toMatchObject({
    value: undefined,
  })
})

test('refuses state above the 256 KB limit', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  await expect(
    writeState(target, 'big', 'x'.repeat(300 * 1024), null, ehr.fetch),
  ).rejects.toThrow('256 KB')
})
