// SMART v2 scopes as the facade grants them: `<context>/<ResourceType>.<letters>`, letters in `cruds`
// order. The facade voids `*` types, v1 `read`/`write` and letters out of order, so they match nothing.
// Used by the `fhir` helper to name a refused scope, and by `requireEhr` to check a page's needs.

export type Interaction = 'c' | 'r' | 'u' | 'd' | 's'

export const SCOPE =
  /^(patient|user|system)\/([A-Z][A-Za-z]*)\.((?=[a-z])c?r?u?d?s?)$/

/** Whether one granted scope allows `interaction` on `type`. A voided or filtered scope allows nothing. */
export function grants(scope: string, type: string, interaction: Interaction) {
  const match = SCOPE.exec(scope)
  if (!match) return false
  const [, , resource, letters = ''] = match
  return resource === type && letters.includes(interaction)
}

/**
 * Whether the granted scopes allow every letter of `needed`, such as `patient/Encounter.rs`.
 * The context (`patient/`, `user/`) is not compared, as in `grants`.
 */
export function covers(granted: string[], needed: string): boolean {
  const match = SCOPE.exec(needed)
  if (!match) throw new TypeError(`Not a SMART v2 scope: ${needed}`)
  const [, , type = '', letters = ''] = match
  return [...letters].every((letter) =>
    granted.some((scope) => grants(scope, type, letter as Interaction)),
  )
}
