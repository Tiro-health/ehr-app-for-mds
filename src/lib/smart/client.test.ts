import { EhrDisconnected } from './client'
import { fakeEhr, launchedClient, testSettings } from './fake-ehr'

async function setup() {
  const settings = testSettings()
  const ehr = fakeEhr()
  ehr.add(
    { resourceType: 'Patient', id: 'p1', name: [{ family: 'Peeters' }] },
    { resourceType: 'Patient', id: 'p2', name: [{ family: 'Janssens' }] },
  )
  return { ehr, client: await launchedClient(ehr, settings, 'p1') }
}

test('reads from the EHR with the access token', async () => {
  const { client } = await setup()
  expect(client.patientId).toBe('p1')
  await expect(client.json('Patient/p1')).resolves.toMatchObject({
    name: [{ family: 'Peeters' }],
  })
})

test('another patient is not found, with the EHR’s reason', async () => {
  const { client } = await setup()
  await expect(client.json('Patient/p2')).rejects.toThrow(
    'The EHR answered 404: Not found.',
  )
})

test('gets a fresh token when the EHR refuses an expired one', async () => {
  const { ehr, client } = await setup()
  ehr.expireAccessTokens()
  await expect(client.json('Patient/p1')).resolves.toMatchObject({ id: 'p1' })
  expect(ehr.grants()[0].revoked).toBe(false)
})

test('many requests after expiry share one refresh, so the grant survives', async () => {
  const { ehr, client } = await setup()
  ehr.expireAccessTokens()
  await Promise.all(Array.from({ length: 5 }, () => client.json('Patient/p1')))
  expect(ehr.refreshes).toHaveLength(1)
  expect(ehr.grants()[0].revoked).toBe(false)
})

test('when the EHR ends the grant, the client says so', async () => {
  const { ehr, client } = await setup()
  ehr.grants()[0].revoked = true
  await expect(client.fetch('Patient/p1')).rejects.toBeInstanceOf(
    EhrDisconnected,
  )
})

test('knows which scopes were granted', async () => {
  const { client } = await setup()
  expect(client.can('Patient', 'r')).toBe(true)
  expect(client.can('Encounter', 's')).toBe(true)
  expect(client.can('Encounter', 'c')).toBe(false)
  expect(client.can('DocumentReference', 'r')).toBe(false)
})
