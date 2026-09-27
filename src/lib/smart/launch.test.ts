import {
  finishLaunch,
  freshConnection,
  readSettings,
  startLaunch,
  type SmartSettings,
} from './launch'
import { APP_STATE, ISS, fakeEhr } from './fake-ehr'

const settings: SmartSettings = {
  clientId: 'my-app',
  clientSecret: 's3cret',
  allowedIssuers: [ISS],
  appUrl: 'https://my-app.tirohealth.app',
  scope: 'openid fhirUser launch user/Basic.cruds',
}

test('settings are only complete with client, secret, issuers and app url', () => {
  expect(readSettings({})).toBeNull()
  expect(
    readSettings({
      SMART_CLIENT_ID: 'a',
      SMART_CLIENT_SECRET: 'b',
      SMART_ISS: `${ISS}/, https://other.example.org/fhir`,
      APP_URL: 'https://my-app.tirohealth.app/',
    }),
  ).toMatchObject({
    allowedIssuers: [ISS, 'https://other.example.org/fhir'],
    appUrl: 'https://my-app.tirohealth.app',
  })
})

test('refuses to launch from an EHR that is not allowed', async () => {
  const ehr = fakeEhr()
  await expect(
    startLaunch(settings, { iss: 'https://evil.example.org/fhir' }, ehr.fetch),
  ).rejects.toThrow('may not be launched')
})

test('refuses an EHR without smart-app-state', async () => {
  const ehr = fakeEhr({ appState: false })
  await expect(
    startLaunch(settings, { iss: ISS, launch: 'x' }, ehr.fetch),
  ).rejects.toThrow('smart-app-state')
})

test('redirects to the EHR with PKCE, then exchanges the code as a confidential client', async () => {
  const ehr = fakeEhr({ associatedEndpoint: true })
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: ISS, launch: 'launch-123' },
    ehr.fetch,
  )
  const url = new URL(redirectTo)
  expect(url.origin + url.pathname).toBe('https://ehr.example.org/authorize')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: 'code',
    client_id: 'my-app',
    redirect_uri: 'https://my-app.tirohealth.app/smart/callback',
    scope: 'openid fhirUser launch user/Basic.cruds',
    aud: ISS,
    launch: 'launch-123',
    state: pending.state,
    code_challenge_method: 'S256',
  })
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pending.verifier),
  )
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  expect(url.searchParams.get('code_challenge')).toBe(expected)
  expect(pending.appStateEndpoint).toBe(APP_STATE)

  const connection = await finishLaunch(
    settings,
    pending,
    { code: 'code-1', state: pending.state },
    ehr.fetch,
  )
  expect(connection).toMatchObject({
    accessToken: 'token-1',
    fhirUser: `${ISS}/Practitioner/123`,
    appStateEndpoint: APP_STATE,
  })
  const [request] = ehr.tokenRequests
  expect(request.auth).toBe(`Basic ${btoa('my-app:s3cret')}`)
  expect(Object.fromEntries(request.form)).toEqual({
    grant_type: 'authorization_code',
    code: 'code-1',
    redirect_uri: 'https://my-app.tirohealth.app/smart/callback',
    code_verifier: pending.verifier,
  })
})

test('a standalone launch does not ask for the launch scope', async () => {
  const ehr = fakeEhr()
  const { redirectTo } = await startLaunch(settings, { iss: ISS }, ehr.fetch)
  expect(new URL(redirectTo).searchParams.get('scope')).toBe(
    'openid fhirUser user/Basic.cruds',
  )
})

test('rejects a callback whose state does not match', async () => {
  const ehr = fakeEhr()
  const { pending } = await startLaunch(settings, { iss: ISS }, ehr.fetch)
  await expect(
    finishLaunch(settings, pending, { code: 'c', state: 'forged' }, ehr.fetch),
  ).rejects.toThrow('could not be verified')
  expect(ehr.tokenRequests).toHaveLength(0)
})

test('refreshes an expired access token', async () => {
  const ehr = fakeEhr()
  const expired = {
    iss: ISS,
    appStateEndpoint: ISS,
    tokenEndpoint: 'https://ehr.example.org/token',
    accessToken: 'old',
    refreshToken: 'refresh-1',
    expiresAt: 0,
    fhirUser: `${ISS}/Practitioner/123`,
  }
  const fresh = await freshConnection(settings, expired, ehr.fetch)
  expect(fresh?.accessToken).toBe('token-1')
  expect(ehr.tokenRequests[0].form.get('grant_type')).toBe('refresh_token')
  expect(
    await freshConnection(
      settings,
      { ...expired, refreshToken: undefined },
      ehr.fetch,
    ),
  ).toBeNull()
})
