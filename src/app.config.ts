/**
 * The identity of this app. The onboarding skill fills this in; edit it freely.
 */
export const appConfig = {
  name: 'My clinical app',
  tagline: 'A tool built by a clinician, for clinicians.',
  ehr: {
    /**
     * What the app may read and write in the EHR, as SMART scopes. `rs` is read and search,
     * `c` create, `u` update, `d` delete. The EHR grants at most what the clinic approved.
     * `offline_access` keeps the app connected for a working session without signing in again.
     */
    scopes: ['patient/Patient.rs', 'patient/Encounter.rs', 'offline_access'],
  },
} as const
