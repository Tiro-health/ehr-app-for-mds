/**
 * The app's own key pair, used to prove to the EHR who it is (`private_key_jwt`, RFC 7523).
 * The private key stays on this server; the public half is published at /.well-known/jwks.json.
 * https://hl7.org/fhir/smart-app-launch/client-confidential-asymmetric.html
 */

export type PrivateJwk = JsonWebKey & { kid: string; alg: SigningAlgorithm }

type SigningAlgorithm = 'ES384' | 'RS384'

const ALGORITHMS: Record<
  SigningAlgorithm,
  {
    import: EcKeyImportParams | RsaHashedImportParams
    sign: AlgorithmIdentifier | EcdsaParams
  }
> = {
  ES384: {
    import: { name: 'ECDSA', namedCurve: 'P-384' },
    sign: { name: 'ECDSA', hash: 'SHA-384' },
  },
  RS384: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
    sign: { name: 'RSASSA-PKCS1-v1_5' },
  },
}

/** Reads SMART_PRIVATE_JWK. Throws with a readable message when the key is unusable. */
export function parsePrivateJwk(text: string): PrivateJwk {
  let jwk: JsonWebKey & { kid?: unknown; alg?: unknown }
  try {
    jwk = JSON.parse(text) as typeof jwk
  } catch {
    throw new Error('SMART_PRIVATE_JWK is not valid JSON.')
  }
  const alg =
    jwk.alg ?? (jwk.kty === 'EC' ? 'ES384' : jwk.kty === 'RSA' ? 'RS384' : '')
  if (alg !== 'ES384' && alg !== 'RS384') {
    throw new Error('SMART_PRIVATE_JWK must be an ES384 (P-384) or RS384 key.')
  }
  if (alg === 'ES384' && (jwk.kty !== 'EC' || jwk.crv !== 'P-384')) {
    throw new Error('SMART_PRIVATE_JWK says ES384 but is not a P-384 key.')
  }
  if (!jwk.d) throw new Error('SMART_PRIVATE_JWK has no private part (d).')
  if (typeof jwk.kid !== 'string' || !jwk.kid) {
    throw new Error('SMART_PRIVATE_JWK needs a kid.')
  }
  return { ...jwk, kid: jwk.kid, alg }
}

/** The public half, safe to publish. */
export function publicJwk(jwk: PrivateJwk): JsonWebKey & { kid: string } {
  const common = { kty: jwk.kty, kid: jwk.kid, alg: jwk.alg, use: 'sig' }
  return jwk.kty === 'EC'
    ? { ...common, crv: jwk.crv, x: jwk.x, y: jwk.y }
    : { ...common, n: jwk.n, e: jwk.e }
}

/**
 * A client assertion for the token endpoint: short-lived, single-use (`jti`), addressed to the
 * token endpoint itself.
 */
export async function clientAssertion(
  jwk: PrivateJwk,
  clientId: string,
  tokenEndpoint: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt(jwk, {
    iss: clientId,
    sub: clientId,
    aud: tokenEndpoint,
    iat: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
  })
}

export async function signJwt(
  jwk: PrivateJwk,
  payload: Record<string, unknown>,
): Promise<string> {
  const algorithm = ALGORITHMS[jwk.alg]
  const { kid, alg, ...material } = jwk
  // A key published with `use` or `key_ops` for verifying would refuse to import for signing.
  delete material.use
  delete material.key_ops
  const key = await crypto.subtle.importKey(
    'jwk',
    material,
    algorithm.import,
    false,
    ['sign'],
  )
  const header = { alg, kid, typ: 'JWT' }
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  // WebCrypto's ECDSA signature is already JOSE's r||s form, so it needs no conversion.
  const signature = await crypto.subtle.sign(
    algorithm.sign,
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

function base64UrlJson(value: unknown) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
