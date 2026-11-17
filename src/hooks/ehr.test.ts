import { QueryClient } from '@tanstack/react-query'
import { isRedirect } from '@tanstack/react-router'
import { contextQuery, requireLaunch } from '@/hooks/ehr'

vi.mock('@/lib/ehr.functions', () => ({
  ehrContext: vi.fn(),
  ehrRead: vi.fn(),
  ehrSearch: vi.fn(),
  ehrCreate: vi.fn(),
  ehrUpdate: vi.fn(),
  ehrDelete: vi.fn(),
}))

function clientWith(answer: unknown) {
  const client = new QueryClient()
  client.setQueryData(contextQuery.queryKey, answer as never)
  return client
}

test('sends a visitor without a session to the explanation page', () => {
  try {
    requireLaunch(clientWith({ launched: false }))
    expect.unreachable('requireLaunch should redirect')
  } catch (thrown) {
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: unknown }).options).toMatchObject({
      to: '/not-launched',
      search: { reason: 'not-from-ehr' },
    })
  }
})

test('lets a launched visitor through', () => {
  const launched = { launched: true, data: { patient: 'patient-1' } }
  expect(() => requireLaunch(clientWith(launched))).not.toThrow()
})
