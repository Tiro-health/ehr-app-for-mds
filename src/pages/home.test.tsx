import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { SmartProvider } from '@/hooks/use-smart'
import { HomePage } from './home'

test('shows the app name, and says it was not opened from the EHR', async () => {
  render(
    <SmartProvider connect={async () => ({ status: 'not-launched' })}>
      <HomePage />
    </SmartProvider>,
  )
  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
  expect(
    await screen.findByText('Not opened from a patient’s chart'),
  ).toBeInTheDocument()
})
