# End-to-end test against the real EHR (for Tiro's developers)

This folder is not part of a clinician's app and a clinician never runs it. It checks the
template itself: the built app, behind the **real** SMART sidecar, launched from the **local
Tiro EHR stack** by a synthetic clinician on a seeded patient, including a session that
outlives its first access token.

Everything SMART stays outside the app, here too. The only credentials this folder touches
are the ones a test must hold to play the EHR's side: a synthetic clinician's sign-in on the
local stack, and a throwaway client key generated in memory for the sidecar container.

It needs a checkout of `Tiro-health/ehr` that contains `smart-sidecar/` (read only: nothing
is changed there), Docker, `psql` and Chromium for Playwright.

```bash
export EHR_REPO=/path/to/ehr                      # the checkout with smart-sidecar/
bash "$EHR_REPO/smart-sidecar/e2e/stack.sh" up    # EHR 3001, facade 8090, GoTrue 9999, db 15432
pnpm test:ehr                                     # builds the app, starts sidecar + app, runs the test
bash "$EHR_REPO/smart-sidecar/e2e/stack.sh" down
```

`pnpm test:ehr` takes about six minutes: an access token lasts 300 seconds, and the test waits
until the first one has ended to see the page still load the patient. `pnpm test:ehr --quick`
skips that wait.

## Launching by hand

To click through a launch yourself, from the EHR's own screens:

```bash
export EHR_REPO=/path/to/ehr
pnpm ehr:up        # starts the EHR stack if needed, the sidecar and the app, and leaves them running
pnpm ehr:reload    # after a change to the app: rebuilds it and restarts its container
pnpm ehr:down      # stops the sidecar, the app and the EHR stack
```

`pnpm ehr:up` ends by printing these steps:

1. Sign in to the EHR at http://localhost:3001/login as the synthetic clinician
   `sidecar-clinician@test.local`, password `password123`. No second factor is asked.
2. Open a patient and go to the Apps tab (the command prints the address of one).
3. Click "Openen" on "Dev sidecar app". The app opens at http://localhost:8080/ with that
   patient and their encounters.

Good to know:

- The EHR's switcher of test users cannot launch an app; sign in as above.
- `pnpm ehr:reload` keeps you launched: the session lives in the sidecar, which is not
  restarted. Refresh the page to see the change.
- Every `pnpm ehr:up` gives the sidecar a new key and restarts it, so earlier sessions end:
  launch again from the EHR. `pnpm test:ehr` does the same and stops the sidecar and the app
  when it is done; run `pnpm ehr:up` again afterwards.
- `pnpm dev` cannot run at the same time: its pretend EHR and the real EHR both use port 3001.

What runs where:

| Piece                 | Where                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| EHR, facade, auth, db | the EHR repository's own stack script                                                                                                |
| Sidecar               | its image, built from `$EHR_REPO/docker/smart-sidecar/Dockerfile`, on `localhost:8080`                                               |
| The app               | this repository's `.output/`, in `node:22-slim` as in production, sharing the sidecar's network (so `127.0.0.1:8081` is the sidecar) |
| Client and clinician  | registered by `$EHR_REPO/smart-sidecar/e2e/seed.sql`                                                                                 |

No CI job runs this; it needs the EHR repository and several minutes.
