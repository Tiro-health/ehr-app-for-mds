// SMART scopes as the EHR grants them: `<context>/<ResourceType>.<letters>`, letters from `cruds`.
// Used by the `fhir` helper to name a refused scope, and by `requireEhr` to check a page's needs.

export type Interaction = 'c' | 'r' | 'u' | 'd' | 's'

export const SCOPE = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/

/** Whether one granted scope allows `interaction` on `type`. A scope with a `?` filter allows nothing here. */
export function grants(scope: string, type: string, interaction: Interaction) {
  const match = SCOPE.exec(scope)
  if (!match) return false
  const [, , resource, rights] = match
  if (resource !== '*' && resource !== type) return false
  const letters =
    rights === '*'
      ? 'cruds'
      : rights === 'read'
        ? 'rs'
        : rights === 'write'
          ? 'cud'
          : rights
  return letters.includes(interaction)
}

/**
 * Whether the granted scopes allow every letter of `needed`, such as `patient/Encounter.rs`.
 * The context (`patient/`, `user/`) is not compared, as in `grants`.
 */
export function covers(granted: string[], needed: string): boolean {
  const match = SCOPE.exec(needed)
  if (!match) throw new TypeError(`Not a SMART scope: ${needed}`)
  const [, , type = '', letters = ''] = match
  return [...letters].every((letter) =>
    granted.some((scope) => grants(scope, type, letter as Interaction)),
  )
}
