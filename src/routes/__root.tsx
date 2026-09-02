import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { appConfig } from '@/app.config'
import '@/styles.css'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This address does not exist in {appConfig.name}.{' '}
        <Link to="/" className="underline">
          Go to the home page
        </Link>
        .
      </p>
    </div>
  )
}

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold">
            {appConfig.name}
          </Link>
          <div className="flex gap-4 text-sm">
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground [&.active]:text-foreground"
            >
              Home
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
      {import.meta.env.DEV && (
        <TanStackRouterDevtools position="bottom-right" />
      )}
    </div>
  )
}
