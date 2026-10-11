import {
  finishLaunch,
  readSettings,
  refreshConnection,
  scopeFor,
  startLaunch,
} from './launch'
import {
  APP_STATE,
  APP_URL,
  CLIENT_ID,
  ISS,
  TOKEN_ENDPOINT,
  fakeEhr,
  testKey,
  testSettings,
} from './fake-ehr'
import { fromBase64Url } from './keys'

async function launch(
  ehr: ReturnType<typeof fakeEhr>,
  settings: Awaited<ReturnType<typeof testSettings>>,
) {
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: ISS, launch: 'launch-abc' },
    ehr.fetch,
  )
  const callback = await ehr.approve(redirectTo, 'p1')
  return {
    redirectTo,
    connection: await finishLaunch(settings, pending, callback, ehr.fetch),
  }
}

test('settings need client id, private key, issuers and app url', async () => {
  const key = JSON.stringify(await testKey())
  expect(readSettings({})).toBeNull()
  expect(readSettings({ SMART_CLIENT_ID: 'a' })).toBeNull()
  expect(
    readSettings({
      SMART_CLIENT_ID: 'a',
      SMART_PRIVATE_JWK: key,
      SMART_ISS: `${ISS}/, https://other.example.org/t/x/fhir/R4`,
      APP_URL: 'https://my-app.tirohealth.app/',
    }),
  ).toMatchObject({
    allowedIssuers: [ISS, 'https://other.example.org/t/x/fhir/R4'],
    appUrl: 'https://my-app.tirohealth.app',
  })
})

test('refuses a private key the EHR would not accept', () => {
  const env = { SMART_CLIENT_ID: 'a', SMART_ISS: ISS, APP_URL: APP_URL }
  expect(() => readSettings({ ...env, SMART_PRIVATE_JWK: '{' })).toThrow(
    'not valid JSON',
  )
  expect(() =>
    readSettings({
      ...env,
      SMART_PRIVATE_JWK: JSON.stringify({
        kty: 'EC',
        crv: 'P-256',
        d: 'x',
        kid: 'k',
      }),
    }),
  ).toThrow('P-384')
})

test('refuses to launch from an EHR that is not allowed', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  await expect(
    startLaunch(settings, { iss: 'https://evil.example.org/fhir' }, ehr.fetch),
  ).rejects.toThrow('may not be launched')
})

test('sends the EHR to sign in with PKCE, state, aud and launch', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: `${ISS}/`, launch: 'launch-abc' },
    ehr.fetch,
  )
  const url = new URL(redirectTo)
  expect(url.origin + url.pathname).toBe(
    'https://ehr.example.org/oauth/authorize',
  )
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: `${APP_URL}/smart/callback`,
    aud: ISS,
    launch: 'launch-abc',
    state: pending.state,
    code_challenge_method: 'S256',
    scope: 'launch patient/Patient.rs patient/Encounter.rs offline_access',
  })
  const challenge = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pending.verifier),
  )
  expect(fromBase64Url(url.searchParams.get('code_challenge')!)).toEqual(
    new Uint8Array(challenge),
  )
})

test('asks for who is signed in and App State only when the EHR offers them', () => {
  const base = {
    authorizationEndpoint: '',
    tokenEndpoint: '',
    capabilities: [] as string[],
    appStateEndpoint: null as string | null,
  }
  const scopes = ['patient/Patient.rs']
  expect(scopeFor(base, 'ehr', scopes)).toBe('launch patient/Patient.rs')
  expect(scopeFor(base, 'standalone', scopes)).toBe(
    'launch/patient patient/Patient.rs',
  )
  expect(scopeFor({ ...base, appStateEndpoint: ISS }, 'ehr', scopes)).toBe(
    'launch patient/Patient.rs',
  )
  expect(
    scopeFor({ ...base, capabilities: ['sso-openid-connect'] }, 'ehr', scopes),
  ).toBe('launch patient/Patient.rs openid fhirUser')
  expect(
    scopeFor(
      { ...base, capabilities: ['sso-openid-connect'], appStateEndpoint: ISS },
      'ehr',
      scopes,
    ),
  ).toBe('launch patient/Patient.rs openid fhirUser user/Basic.cruds')
})

test('signs in with private_key_jwt and keeps the patient context', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { connection } = await launch(ehr, settings)
  expect(connection).toMatchObject({
    iss: ISS,
    tokenEndpoint: TOKEN_ENDPOINT,
    patient: 'p1',
    scope: 'patient/Patient.rs patient/Encounter.rs offline_access',
  })
  expect(connection.refreshToken).toBeTruthy()
  expect(connection.fhirUser).toBeUndefined()
  expect(connection.appStateEndpoint).toBeUndefined()
  const exchange = ehr.tokenRequests[0]
  expect(exchange.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  )
  expect(exchange.has('client_secret')).toBe(false)
})

test('a client assertion signed with another key is refused', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: ISS, launch: 'l' },
    ehr.fetch,
  )
  const callback = await ehr.approve(redirectTo, 'p1')
  const impostor = { ...settings, privateJwk: await testKey() }
  await expect(
    finishLaunch(impostor, pending, callback, ehr.fetch),
  ).rejects.toThrow('401 invalid_client')
})

test('a callback with another state is refused', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: ISS, launch: 'l' },
    ehr.fetch,
  )
  const callback = await ehr.approve(redirectTo, 'p1')
  await expect(
    finishLaunch(
      settings,
      pending,
      { ...callback, state: 'forged' },
      ehr.fetch,
    ),
  ).rejects.toThrow('could not be verified')
  await expect(
    finishLaunch(
      settings,
      pending,
      { error: 'access_denied', errorDescription: 'no second factor' },
      ehr.fetch,
    ),
  ).rejects.toThrow('refused the sign-in: access_denied (no second factor)')
})

test('reads fhirUser and App State when the EHR offers them', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings, { openid: true, appState: 'associated' })
  const { redirectTo, connection } = await launch(ehr, settings)
  expect(new URL(redirectTo).searchParams.get('scope')).toContain(
    'openid fhirUser user/Basic.cruds',
  )
  expect(connection).toMatchObject({
    fhirUser: `${ISS}/Practitioner/123`,
    appStateEndpoint: APP_STATE,
  })
})

test('refreshes with the rotated token, and shares one refresh between requests', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { connection } = await launch(ehr, settings)

  // Two requests arrive with the same cookie at once: one refresh, not two.
  const [a, b] = await Promise.all([
    refreshConnection(settings, connection, ehr.fetch),
    refreshConnection(settings, connection, ehr.fetch),
  ])
  expect(a).toEqual(b)
  expect(a!.refreshToken).not.toBe(connection.refreshToken)
  expect(ehr.grants()[0].revoked).toBe(false)

  const again = await refreshConnection(settings, a!, ehr.fetch)
  expect(again!.accessToken).not.toBe(a!.accessToken)
  expect(ehr.grants()[0].revoked).toBe(false)
})

test('a refresh the EHR refuses ends the connection', async () => {
  const settings = await testSettings()
  const ehr = fakeEhr(settings)
  const { connection } = await launch(ehr, settings)
  ehr.grants()[0].revoked = true
  expect(await refreshConnection(settings, connection, ehr.fetch)).toBeNull()
  expect(
    await refreshConnection(
      settings,
      { ...connection, refreshToken: undefined },
      ehr.fetch,
    ),
  ).toBeNull()
})
