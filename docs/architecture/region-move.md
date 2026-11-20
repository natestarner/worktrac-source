# Moving the backend to Central US

> **STATUS (2026-11-20): planned, nothing done.** Do the phases in order. Write the date and the
> outcome under each step as it is done. Why this move: `latency.md`. Who does what: steps marked
> **[you]** need Azure write access, the DNS registrar or App Store Connect, which Claude doesn't
> have. Claude does the deploy-repo PRs and all the checking.

## What moves and what doesn't

The two Container Apps (`worktrac-backend-prod`, `worktrac-backend-lower`) and their environment
`worktrac-env` move from East US to Central US. The database is already in Central US. **Nothing
stateful moves:**
- **Stays:** the database, the API hostnames (`api.huddle.fitness`, `api.dev.huddle.fitness`), the
  Static Web Apps (frontend and marketing, served from a CDN), email (ACS, global), the action group,
  the Log Analytics workspace (East US; logs from another region are fine) and the image registry.
- **Changes:** the environment (new: `worktrac-env-cus`), the app names (new: `worktrac-backend-prod-cus`,
  `worktrac-backend-lower-cus`), their raw `*.centralus.azurecontainerapps.io` addresses, outbound IPs
  and managed certificates.

The app names have to change: a name can't be reused in `worktrac-rg` while the old app exists, and
the old app stays up as the rollback until the move is proven.

## Checked before writing this (2026-11-20)

| Question | Answer |
|---|---|
| Does the database firewall need the new outbound IPs? | **No.** `worktrac-sql-server` allows Azure services (`AllowAzureServices`, 0.0.0.0) |
| Do the custom domains need new `asuid` TXT records? | **No.** The verification ID is per subscription (both environments here share `165AE077…`), and the TXT records already hold it |
| Can two backends safely share the database during the switch? | **Yes.** Several replicas are already supported (`scaling.md`): ShedLock for scheduled jobs, the access-invalidation log, the outbox with leases. Session tokens are stateless and share the signing secret |
| Does it cost more? | **No.** Consumption prices are identical in both regions (Azure Retail Prices API: $0.000024/vCPU-s active, $0.000003/GiB-s). There's a few days of double prod running cost while the old app is kept as the rollback |
| What else calls the raw East US address? | **Two things**: iOS 1.0.0 (build 9) and the email delivery webhook. See "Downsides" 2 and 3 |
| DNS | Namecheap (`registrar-servers.com`). The API CNAMEs have a **30-minute TTL** |

## Downsides, and what each step does about them

1. **Each request now travels further from the user to the app.** Measured from home (TCP connect,
   best of 6): East US **~32 ms**, Central US **~65 ms**, so **+~33 ms per request** and ~+66 ms on a
   brand-new connection (TCP + TLS). It is paid once per request, and an app open's parallel requests
   share one connection. Every API request makes at least 5 database trips at ~25–35 ms each today,
   so every request still comes out ahead: `/me` gains ~250–350 ms and loses ~33. Users further west
   gain on both sides. The trade only turns against us when most users are far from Central US, and
   the answer then is a second region, which keeping the `api.` hostnames leaves open.
2. **iOS 1.0.0 (build 9) has the raw East US address built in** (release run 40519977445,
   2026-10-27; `NATIVE_API_URL` switched to `api.huddle.fitness` on 2026-11-02). Once the old app is
   deleted, build 9 can't reach the server. It doesn't lose data: it degrades to offline (cached reads,
   queued writes), and the outbox lives in WebKit storage, which an App Store update keeps, so it
   drains on update. Last 30 days: 4 people on build 9, **last seen 2026-11-12**. Step 0.2 shows those
   people the update banner first, and the old app isn't deleted until build 9 is gone.
3. **The email delivery-status webhook calls the raw East US address.** The Event Grid subscriptions
   `email-delivery-webhook-prod` and `worktrac-email-delivery-lower` post to
   `…whitehill-3dc27bb3.eastus.azurecontainerapps.io/api/webhooks/email-delivery`. Left alone, bounce
   and delivery status would silently stop being recorded once the old app goes. Step 0.1 points them
   at the custom domains, which is right regardless of this move.
4. **A few minutes of TLS errors at cutover.** A managed certificate is only issued once the CNAME
   points at the new app. Anyone whose DNS has already switched gets certificate errors until it is
   issued. The app treats that like a server blip: writes queue, reads come from cache, nothing is lost.
   To keep it small: lower the TTL first (0.3), cut over at a quiet hour, and roll back by flipping
   the CNAME back if the certificate sticks in Pending (the old app keeps its certificate). The only
   zero-gap alternative is uploading our own certificate, which isn't worth it for minutes.
5. **Deploys during the overlap.** While both apps run, a deploy updates only the app the Bicep names,
   leaving the other on older code against a newer schema. **Freeze lower→production promotions** from
   the prod cutover until the old prod app is deleted, and keep that window short.
6. **New names ripple.** Alert scopes (`monitoring.bicep`), the saved KQL queries
   (`ContainerAppName_s == 'worktrac-backend-prod'` in `latency.md`, `azure-read-only-access.md` and
   `.claude/rules`), the deploy workflows' health URLs, and memory notes. Phase 3 lists them; grep for
   the old names before calling it done.
7. **Central US might refuse.** East US refused SQL servers on this subscription. Step 0.4 creates the
   environment first, with nothing depending on it, so a refusal costs nothing and stops the plan
   there.
8. **Region risk: no worse, slightly better.** Today an outage in *either* region takes the app down,
   because the database is in Central US. Afterwards only a Central US outage does, and that was
   already true.
9. **Not downsides:** Stripe and Apple webhooks, Sign in with Apple/Google, the iOS builds from
   1.1.0 on, CORS and the CSP all use the custom domains or the frontend's origin, so they don't
   change. During DNS propagation they may land on either app, and both answer correctly.
10. **Open decision: the legacy `*.starnerconsulting.co` API hostnames** (`worktrac-api.`,
    `worktrac-api-dev.`) are still bound with certificates. Nothing in either repo references them
    since #473, but the backend doesn't log `Host`, so their use can't be proven to be zero.
    **Default: move them too** (the same two steps as the `api.` names). Retire them in a later change
    once evidence exists.

## Phase 0 — prep (no user-visible change; days before)

- **0.1 [you] Point the email webhooks at the custom domains.** Event Grid re-runs its validation
  handshake against the new URL, and the endpoint already answers it. Afterwards, check that a test
  email's delivery event is recorded on each environment.
  ```bash
  az eventgrid system-topic event-subscription update -g worktrac-rg --system-topic-name worktrac-comms-lower-topic -n worktrac-email-delivery-lower --endpoint https://api.dev.huddle.fitness/api/webhooks/email-delivery
  ```
  ```bash
  az eventgrid system-topic event-subscription update -g worktrac-rg --system-topic-name worktrac-comms-prod-topic -n email-delivery-webhook-prod --endpoint https://api.huddle.fitness/api/webhooks/email-delivery
  ```
- **0.2 Banner for build 9.** A deploy-repo PR sets `NATIVE_MIN_SUPPORTED_BUILD=18` (1.1.0) on prod.
  This is a banner, never a gate (`api-compatibility.md`). Re-run "Which app builds are live?"
  (`azure-read-only-access.md`) before deleting the old prod app in 2.6.
- **0.3 [you] Lower the TTL** on the `api` and `api.dev` CNAMEs (and the two legacy names) from 30
  minutes to 5, at least 30 minutes before each cutover.
- **0.4 [you] Create the Central US environment** in `worktrac-rg`, sending logs to `worktrac-logs`
  (the workspace key is under the workspace's Agents blade):
  ```bash
  az containerapp env create -g worktrac-rg -n worktrac-env-cus -l centralus --logs-destination log-analytics --logs-workspace-id ed5b43a9-96fa-4194-9fb4-0d4b7932a86a --logs-workspace-key <key>
  ```
  If Central US refuses, stop here and record the error.

## Phase 1 — lower

- **1.1 Deploy-repo PR (`lower`).**
  - `lower.bicepparam`: `location = 'centralus'`, `managedEnvironmentName = 'worktrac-env-cus'`,
    `appName = 'worktrac-backend-lower-cus'`, `customDomains = []` for now.
  - `deploy-lower.yml`: its four health checks use the new raw address.
  - Merging deploys a **new** app beside the old one; Bicep deletes nothing, and `api.dev` still
    points at the old app.
- **1.2 Prove the new app before any traffic moves.**
  - health, plus a signed-in `/me` and a History sync against the raw `*.centralus` address
  - the round-trip timing: expect `/me` alone well under the ~350 ms prod shows today
- **1.3 [you] Cut over `api.dev`.**
  - Point the CNAME at the new app's raw address.
  - Bind the hostname with a managed certificate:
    `az containerapp hostname add` and then `az containerapp hostname bind … --validation-method CNAME`.
  - Then a deploy-repo PR adds it to `customDomains`, so the next Bicep deploy keeps it.
- **1.4 Verify on lower:**
  - the nightly e2e (`gh workflow run lower-e2e-nightly.yml`)
  - `/barrage quick`
  - the `latency.md` KQL before and after
  - an email delivery event recorded
- **1.5 [you] Delete the old lower app** after a few quiet days.

## Phase 2 — production (same steps, at a quiet hour)

- **2.1 Freeze lower→production promotions** until 2.6.
- **2.2 Deploy-repo PR (`production`):** `prod.bicepparam` and `deploy-prod.yml`, as in 1.1.
  The new app starts with `minReplicas = 1` beside the old one.
- **2.3 Prove it** at its raw address, as in 1.2.
- **2.4 [you] Cut over `api.huddle.fitness`** (and the legacy name), as in 1.3. Watch `/me` errors and
  the 5xx alert for the hour after.
  - **Rollback:** point the CNAME back to the old app. It still runs, with its certificate, and the TTL
    is 5 minutes.
- **2.5 Compare:** the `/me` p50/p90 and slow-sync KQL in `latency.md`, against the numbers recorded
  there.
- **2.6 [you] Delete the old prod app**, once a week has passed with no rollback and build 9 is gone
  from the live-builds query. Then unfreeze promotions, and restore the 30-minute TTL.

## Phase 3 — cleanup

- `monitoring.bicep`: alert scopes point to the new prod app's ID. Confirm each alert still evaluates.
- Rename everywhere: `ContainerAppName_s` and app names in:
  - `docs/azure-read-only-access.md`, `latency.md`, `scaling.md`, `.claude/rules/*`
  - the memory notes
  - `rg -n "worktrac-backend-(prod|lower)\b|worktrac-env\b|eastus"` across both repos should only find
    history
- `docs/architecture/latency.md`: replace the "different regions" section with the measured result.
- **[you]** Delete `worktrac-env` once both old apps are gone. Its managed certificates go with it.
  `interactive-timeline-env` is another project's environment; leave it alone.
