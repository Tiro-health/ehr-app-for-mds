import type { Basic } from 'fhir/r4'
import { readState, valueExtensionUrl, writeState } from './app-state'
import type { AppStateFhir, AppStateTarget } from './app-state'
import { FhirRequestError } from '@/lib/fhir/errors'

const system = 'https://my-app.tirohealth.app'

/** Stores Basic resources like the EHR: versions, and a refusal on a stale version (412). */
function fakeEhr() {
  const stored = new Map<string, Basic>()
  let nextId = 1
  const fhir: AppStateFhir = {
    search: async (_type, params) =>
      [...stored.values()].filter(
        (r) =>
          r.subject?.reference === params.subject &&
          r.code.coding?.some((c) => `${c.system}|${c.code}` === params.code),
      ),
    create: async (resource) => {
      const id = String(nextId++)
      const saved = { ...resource, id, meta: { versionId: '1' } }
      stored.set(id, saved)
      return saved
    },
    update: async (resource) => {
      const now = stored.get(resource.id!)
      if (!now || now.meta?.versionId !== resource.meta?.versionId) {
        throw new FhirRequestError(412, 'Updating Basic')
      }
      const versionId = String(Number(now.meta!.versionId) + 1)
      const saved = { ...resource, meta: { versionId } }
      stored.set(resource.id!, saved)
      return saved
    },
  }
  const target: AppStateTarget = {
    fhir,
    system,
    subject: 'Practitioner/123',
  }
  return { stored, target }
}

test('creates, reads and updates state for the signed-in practitioner', async () => {
  const { stored, target } = fakeEhr()
  expect(await readState(target, 'click-count')).toBeNull()

  const created = await writeState(target, 'click-count', 1, null)
  expect(created).toMatchObject({
    status: 'saved',
    state: { value: 1, version: '1' },
  })

  const basic = [...stored.values()][0]!
  expect(basic.code).toEqual({ coding: [{ system, code: 'click-count' }] })
  expect(basic.subject).toEqual({ reference: 'Practitioner/123' })
  expect(basic.extension).toEqual([
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
  const { target } = fakeEhr()
  const first = await writeState(target, 'notes', { text: 'a' }, null)
  if (first.status !== 'saved') throw new Error('expected saved')
  await writeState(target, 'notes', { text: 'b' }, first.state)

  const stale = await writeState(target, 'notes', { text: 'c' }, first.state)
  expect(stale).toMatchObject({
    status: 'conflict',
    state: { value: { text: 'b' } },
  })
})

test('a second create for the same state is a conflict that returns the stored state', async () => {
  const { stored, target } = fakeEhr()
  await writeState(target, 'notes', 'first', null)
  expect(await writeState(target, 'notes', 'second', null)).toMatchObject({
    status: 'conflict',
    state: { value: 'first' },
  })
  expect(stored.size).toBe(1)
})

test('state of another practitioner is not returned', async () => {
  const { target } = fakeEhr()
  await writeState(target, 'click-count', 5, null)
  const other = { ...target, subject: 'Practitioner/999' }
  expect(await readState(other, 'click-count')).toBeNull()
})

test('unreadable stored content is ignored, not thrown', async () => {
  const { stored, target } = fakeEhr()
  await writeState(target, 'click-count', 1, null)
  ;[...stored.values()][0]!.extension = [
    { url: valueExtensionUrl(system), valueString: '{not json' },
  ]
  expect(await readState(target, 'click-count')).toMatchObject({
    value: undefined,
  })
})

test('refuses state above the 256 KB limit', async () => {
  const { target } = fakeEhr()
  await expect(
    writeState(target, 'big', 'x'.repeat(300 * 1024), null),
  ).rejects.toThrow('256 KB')
})
