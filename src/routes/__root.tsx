import type { ReactNode } from 'react'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { appConfig } from '@/app.config'
import appCss from '@/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: appConfig.name },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

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
