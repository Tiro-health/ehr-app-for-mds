import type { OperationOutcome } from 'fhir/r4'

/**
 * The app was not opened from the EHR, or the EHR session has ended.
 * A page that cannot work without a patient sends the visitor to `/not-launched`.
 */
export class NotLaunchedError extends Error {
  override name = 'NotLaunchedError'
  constructor() {
    super('The app was not opened from the EHR, or the session has ended.')
  }
}

/**
 * The EHR refused the request because the app was not granted the permission it needs:
 * the app is not registered for it, or the clinic did not approve it. `scope` names it.
 * Tiro registers what an app may ask for; listing the scope in `smart.json` records the
 * need and makes the local preview grant it, but does not by itself change the EHR.
 */
export class ScopeRefusedError extends Error {
  override name = 'ScopeRefusedError'
  constructor(readonly scope: string) {
    super(
      `The EHR refused this request: the app was not granted "${scope}". ` +
        `List "${scope}" in smart.json and ask Tiro to register it for this app; ` +
        `the clinic then approves it.`,
    )
  }
}

/**
 * Any other refusal from the EHR (not found, invalid search, file too large, ...).
 * The message never contains patient data; `outcome` holds the EHR's own explanation.
 */
export class FhirRequestError extends Error {
  override name = 'FhirRequestError'
  constructor(
    readonly status: number,
    what: string,
    readonly outcome?: OperationOutcome,
  ) {
    super(`${what} failed (status ${status}).`)
  }
}
