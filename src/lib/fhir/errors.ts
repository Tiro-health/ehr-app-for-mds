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
 * The EHR refused the request because the app did not ask for the permission it needs.
 * `scope` is the line to add to the `scopes` list in `smart.json`.
 */
export class ScopeRefusedError extends Error {
  override name = 'ScopeRefusedError'
  constructor(readonly scope: string) {
    super(
      `The EHR refused this request: the app has no permission "${scope}". ` +
        `Add "${scope}" to the scopes in smart.json.`,
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
