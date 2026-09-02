import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { HomePage } from './home'

test('shows the app name', () => {
  render(<HomePage />)
  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
})
