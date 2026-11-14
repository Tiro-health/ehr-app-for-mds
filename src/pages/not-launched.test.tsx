import { render, screen } from '@testing-library/react'
import { REASON_CODES } from '../../dev/fake-sidecar.mjs'
import { NotLaunchedPage, REASONS } from './not-launched'

test('explains that the app is opened from the EHR', () => {
  render(<NotLaunchedPage reason="not-from-ehr" />)
  expect(
    screen.getByRole('heading', { name: 'Open this app from the EHR' }),
  ).toBeInTheDocument()
})

test('has a text for every reason the platform can send', () => {
  expect(Object.keys(REASONS).sort()).toEqual([...REASON_CODES].sort())
})

test('still explains what to do for a reason it does not know', () => {
  render(<NotLaunchedPage reason="something-new" />)
  expect(screen.getByRole('heading')).toHaveTextContent(
    'The app could not be opened from the EHR',
  )
})
