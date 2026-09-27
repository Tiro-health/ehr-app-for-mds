import { appConfig } from '@/app.config'
import { Button } from '@/components/ui/button'
import { useAppState, type AppStateStatus } from '@/hooks/use-app-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function HomePage() {
  const [clicks, setClicks, saved] = useAppState('click-count', 0, {
    parse: (v) =>
      typeof v === 'number' && Number.isInteger(v) ? v : undefined,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {appConfig.name}
        </h1>
        <p className="mt-2 text-muted-foreground">{appConfig.tagline}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your app is running</CardTitle>
          <CardDescription>
            This is the example page. Ask Claude Code to replace it with your
            first tool.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button onClick={() => setClicks((n) => n + 1)}>Click me</Button>
          <span className="text-sm text-muted-foreground">
            Clicked {clicks} {clicks === 1 ? 'time' : 'times'}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {savedLabel[saved]}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}

const savedLabel: Record<AppStateStatus, string> = {
  loading: '',
  ehr: 'Saved in the EHR',
  device: 'Saved on this device',
  conflict: 'Updated elsewhere: showing the latest',
  error: 'Could not save',
}
