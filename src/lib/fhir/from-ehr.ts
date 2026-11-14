import { NotLaunchedError } from '@/lib/fhir/errors'

/** What a page gets back: the data, or the fact that the app was not opened from the EHR. */
export type FromEhr<T> = { launched: true; data: T } | { launched: false }

/** Runs `ask` and turns "not opened from the EHR" into a normal answer instead of an error. */
export async function fromEhr<T>(ask: () => Promise<T>): Promise<FromEhr<T>> {
  try {
    return { launched: true, data: await ask() }
  } catch (error) {
    if (error instanceof NotLaunchedError) return { launched: false }
    throw error
  }
}
