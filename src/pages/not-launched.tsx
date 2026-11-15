import { appConfig } from '@/app.config'

// Shown when the app cannot show a patient: it was not opened from the EHR, the EHR
// refused, or the session ended. The platform sends the visitor here with a reason code.

interface Explanation {
  title: string
  body: string
}

const OPEN_FROM_EHR =
  'Open the patient in the EHR and start this app from the Apps tab.'

export const REASONS: Record<string, Explanation> = {
  'not-from-ehr': {
    title: 'Open this app from the EHR',
    body: `This app shows data of the patient you have open in the EHR. ${OPEN_FROM_EHR}`,
  },
  'unknown-ehr': {
    title: 'This EHR is not connected to the app',
    body: 'The app was opened from an EHR it does not know. Ask Tiro to connect this app to your clinic.',
  },
  'ehr-unreachable': {
    title: 'The EHR could not be reached',
    body: 'The EHR did not answer. Wait a moment, then start the app again from the EHR.',
  },
  'ehr-failed': {
    title: 'The EHR could not open the app',
    body: 'Something went wrong in the EHR while opening the app. Start the app again from the EHR; if it keeps happening, contact Tiro.',
  },
  'ehr-refused': {
    title: 'The EHR did not allow the app to open',
    body: 'Your clinic has not approved this app for you, or the approval was withdrawn. Ask your clinic administrator.',
  },
  expired: {
    title: 'Your session has ended',
    body: `For safety the connection with the EHR closes after a while. ${OPEN_FROM_EHR}`,
  },
  'no-identity': {
    title: 'The EHR did not say who you are',
    body: 'The app could not see which clinician is signed in. Sign in to the EHR again and start the app from there.',
  },
  'identity-invalid': {
    title: 'Your sign-in could not be checked',
    body: 'The app could not confirm who is signed in to the EHR. Sign in to the EHR again and start the app from there.',
  },
  'no-patient': {
    title: 'No patient was open',
    body: `This app needs a patient. ${OPEN_FROM_EHR}`,
  },
  'scope-missing': {
    title: 'The app was not given the access it needs',
    body: 'The EHR did not grant everything this app asks for. Ask your clinic administrator to approve the app again.',
  },
}

const UNKNOWN: Explanation = {
  title: 'The app could not be opened from the EHR',
  body: OPEN_FROM_EHR,
}

export function NotLaunchedPage({ reason }: { reason?: string }) {
  const { title, body } = (reason && REASONS[reason]) || UNKNOWN

  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <p className="text-sm text-muted-foreground">
        You are looking at {appConfig.name}.
      </p>
    </div>
  )
}
