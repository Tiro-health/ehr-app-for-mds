import { createFileRoute } from '@tanstack/react-router'
import { NotLaunchedPage } from '@/pages/not-launched'

export const Route = createFileRoute('/not-launched')({
  validateSearch: (search): { reason?: string } =>
    typeof search.reason === 'string' ? { reason: search.reason } : {},
  component: NotLaunchedRoute,
})

function NotLaunchedRoute() {
  const { reason } = Route.useSearch()
  return <NotLaunchedPage reason={reason} />
}
