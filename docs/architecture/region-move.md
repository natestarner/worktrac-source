# Moving the backend to Central US

> **STATUS (2026-11-20): both environments run in Central US.** Lower cut over at ~22:05 UTC and prod
> at 23:08 UTC. The old East US apps are still running as the rollback; Phase 3 (deleting them) is
> due from 2026-11-27. Do the phases in order. Write the date and the outcome under each step as it is done. Why this move: `latency.md`. Who does what: steps marked
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
   drains on update. Build 9 was used by four logins in all (checked 2026-11-20, last seen 2026-11-12):
   - **uid 1:** the owner's own login. It has since moved to newer builds.
   - **uid 32:** a test login, signed in on the same install as uid 1.
   - **uid 31:** the App Store reviewer demo login. It shares an install and home IPs with uid 1, and
     was used from Apple's network (17.0.0.0/8).
   - **uid 34:** someone the owner knows, who will be asked to update. Signed up on the web on
     2026-11-08, then signed in on build 9 over one 20-minute visit, and hasn't been seen since.

   **Decision (owner, 2026-11-20): build 9 gets no special handling.** No minimum-build bump, and
   no waiting on build 9 before deleting the old app.

   How this was attributed: `[cid=…]` is a per-install id (`frontend/src/lib/correlationId.js`), so
   "which logins share an install with uid 1" separates the owner's test logins from real ones.
3. **The email delivery-status webhook calls the raw East US address.** The Event Grid subscriptions
   `email-delivery-webhook-prod` and `worktrac-email-delivery-lower` post to
   `…whitehill-3dc27bb3.eastus.azurecontainerapps.io/api/webhooks/email-delivery`. Left alone, bounce
   and delivery status would silently stop being recorded once the old app goes. Step 0.1 points them
   at the custom domains, which is right regardless of this move.
4. **A few minutes of TLS errors at cutover.** A managed certificate is only issued once the CNAME
   points at the new app. Anyone whose DNS has already switched gets certificate errors until it is
   issued. The app treats that like a server blip: writes queue, reads come from cache, nothing is lost.
   To keep it small: lower the TTL first (0.2), cut over at a quiet hour, and roll back by flipping
   the CNAME back if the certificate sticks in Pending (the old app keeps its certificate). The only
   zero-gap alternative is uploading our own certificate, which isn't worth it for minutes.
5. **Deploys during the overlap.** While both apps run, a deploy updates only the app the Bicep names,
   leaving the other on older code against a newer schema. **Freeze lower→production promotions** from
   the prod cutover until the old prod app is deleted, and keep that window short.
6. **New names ripple.** Alert scopes (`monitoring.bicep`), the saved KQL queries
   (`ContainerAppName_s == 'worktrac-backend-prod'` in `latency.md`, `azure-read-only-access.md` and
   `.claude/rules`), the deploy workflows' health URLs, and memory notes. Phase 3 lists them; grep for
   the old names before calling it done.
7. **Central US might refuse.** East US refused SQL servers on this subscription. Step 0.3 creates the
   environment first, with nothing depending on it, so a refusal costs nothing and stops the plan
   there.
8. **Region risk: no worse, slightly better.** Today an outage in *either* region takes the app down,
   because the database is in Central US. Afterwards only a Central US outage does, and that was
   already true.
9. **Not downsides:** Stripe and Apple webhooks, Sign in with Apple/Google, the iOS builds from
   1.1.0 on, CORS and the CSP all use the custom domains or the frontend's origin, so they don't
   change. During DNS propagation they may land on either app, and both answer correctly.
10. **The legacy `*.starnerconsulting.co` API hostnames are dropped, not moved.**
    `worktrac-api.` and `worktrac-api-dev.` are still bound with certificates, but nothing ever
    shipped with them. Checked 2026-11-20:
    - **Web config:** every `apiUrl` either repo has ever had is a raw `*.eastus` name or an `api.`
      name.
    - **iOS:** every release run's `NATIVE_API_URL` is likewise a raw `*.eastus` name or an `api.`
      name.
    - **The only other use:** the deploy workflow's health check, which #473 removed.

    They are simply not added in the new environment, and their CNAMEs can go once the old apps are
    deleted. The *frontend* names `worktrac-app.` / `worktrac-dev.starnerconsulting.co` are a separate
    matter: they are still bound on the Static Web Apps and listed in `CORS_ALLOWED_ORIGINS`. This move
    doesn't touch them, and retiring them is its own change.

## Phase 0 — prep (no user-visible change) — DONE 2026-11-20

- **0.1 [you] Point the email webhooks at the custom domains.** DONE. The webhook authenticates with
  `?key=…` in its URL (`EmailDeliveryWebhookController`), so the update must keep the query string:
  read the full URL with `--include-full-endpoint-url` and swap only the host. Event Grid re-runs
  its validation handshake against the new URL, so wake lower first (it scales to zero).
  ```powershell
  Invoke-WebRequest https://api.dev.huddle.fitness/actuator/health -UseBasicParsing -TimeoutSec 90 | Out-Null; $u = az eventgrid system-topic event-subscription show -g worktrac-rg --system-topic-name worktrac-comms-lower-topic -n worktrac-email-delivery-lower --include-full-endpoint-url --query destination.endpointUrl -o tsv; az eventgrid system-topic event-subscription update -g worktrac-rg --system-topic-name worktrac-comms-lower-topic -n worktrac-email-delivery-lower --endpoint ($u -replace '^https://[^/]+', 'https://api.dev.huddle.fitness') --query provisioningState -o tsv
  ```
  ```powershell
  $u = az eventgrid system-topic event-subscription show -g worktrac-rg --system-topic-name worktrac-comms-prod-topic -n email-delivery-webhook-prod --include-full-endpoint-url --query destination.endpointUrl -o tsv; az eventgrid system-topic event-subscription update -g worktrac-rg --system-topic-name worktrac-comms-prod-topic -n email-delivery-webhook-prod --endpoint ($u -replace '^https://[^/]+', 'https://api.huddle.fitness') --query provisioningState -o tsv
  ```
- **0.2 [you] Lower the TTL** on the `api` and `api.dev` CNAMEs from 30 minutes to 5 (Namecheap →
  Advanced DNS). DONE.
- **0.3 [you] Create the Central US environment.** DONE: `worktrac-env-cus`, default domain
  `wittygrass-413cc690.centralus.azurecontainerapps.io`, logs to `worktrac-logs`. Central US allowed it.
  ```powershell
  az containerapp env create -g worktrac-rg -n worktrac-env-cus -l centralus --logs-destination log-analytics --logs-workspace-id ed5b43a9-96fa-4194-9fb4-0d4b7932a86a --logs-workspace-key (az monitor log-analytics workspace get-shared-keys -g worktrac-rg -n worktrac-logs --query primarySharedKey -o tsv) --query properties.provisioningState -o tsv
  ```

## Phase 1 — lower — cut over 2026-11-20

- **1.1 Deploy-repo PR (`lower`).** DONE, worktrac-deploy #100: `lower.bicepparam` gets
  `appName = 'worktrac-backend-lower-cus'`, `location = 'centralus'`,
  `managedEnvironmentName = 'worktrac-env-cus'` and `customDomains = []`, and `deploy-lower.yml`'s
  four health checks use the new raw address. The PR's what-if showed exactly one change, "Create
  containerApps/worktrac-backend-lower-cus". (Its *prod* what-if on a `lower`-based PR shows
  unrelated deletes: `lower`'s copy of `prod.bicepparam` is older than `production`'s. Ignore it.)
- **1.2 Prove the new app before any traffic moves.** DONE. Signed in with the barrage account
  against both apps, median of 10 from the owner's machine:

  | Request | East US (old) | Central US (new) |
  |---|---|---|
  | `/me` | 334 ms | 98 ms |
  | `/api/tags` | 199 ms | 82 ms |
  | History sync, nothing new (5-year account) | 508 ms | 262 ms |

- **1.3 [you] Cut over `api.dev`.** DONE. The order matters, and `bind` alone fails:
  1. Namecheap: point the CNAME at the new app's raw address.
  2. **`hostname add` first.** `bind` on a hostname the app doesn't have yet fails with
     `RequireCustomHostnameInEnvironment`.
     ```powershell
     az containerapp hostname add -g worktrac-rg -n worktrac-backend-lower-cus --hostname api.dev.huddle.fitness -o none
     ```
  3. Then bind, which issues the managed certificate. It took **~7 minutes**, during which
     `api.dev` served certificate errors (the app reads that as offline; nothing is lost).
     ```powershell
     az containerapp hostname bind -g worktrac-rg -n worktrac-backend-lower-cus --hostname api.dev.huddle.fitness --environment worktrac-env-cus --validation-method CNAME --query "[].{host:name,binding:bindingType}" -o table
     ```
  4. **Straight away**, a deploy-repo PR records it in `customDomains` with the issued certificate's
     name (worktrac-deploy #101, `mc-worktrac-env-c-api-dev-huddle-f-5278`). Until it merges, any
     deploy (every merge to main promotes to lower) applies `customDomains = []` and removes the
     binding.
- **1.4 Verify on lower.** DONE 2026-11-20, all against the new app:
  - full nightly e2e: Chrome 494 passed / 0 failed (2 passed on retry), WebKit green
  - `/barrage quick`: 39 passed. The 2 failures were "holds no finished workout in 2026-10": the
    barrage account's data ends 2026-09-25, and both passed re-run with `BARRAGE_TODAY=2026-10-20`.
    No drift, no unexpected exceptions.
  - server-side `/me` p50: 314 -> 16 ms
  - email delivery events delivered to the new address (Event Grid: 0 failed deliveries)
- **1.5 [you] Delete the old lower app** after a few quiet days (see Phase 3).

## Phase 2 — production — cut over 2026-11-20 23:08 UTC

- **2.1 Freeze lower→production promotions** while both apps take traffic. Lifted once the old app's
  request log went quiet (23:10): from then a promotion deploys only the new app. If a rollback to
  the old app is ever needed after a promotion, redeploy the old app's image first.
- **2.2 Deploy-repo PR (`production`).** DONE, worktrac-deploy #102: `prod.bicepparam` as in 1.1
  (`worktrac-backend-prod-cus`, `customDomains = []`), and `deploy-prod.yml`'s revision wait, health
  check and smoke test on the new app. What-if: only "Create".
- **2.3 Prove it.** DONE. Checked before any DNS change:
  - config identical to the old app: 38 env vars, 21 secret names, ingress, probes and scaling
  - signed in with the screenshot demo account: a token minted by the old app is accepted by the
    new one (same signing secret, so nobody is signed out at cutover), with identical `/me` and
    History sync answers
  - `/me` 341 -> 82 ms from the owner's machine
  - The demo password has special characters: read the creds file in Node, never through a shell
    (`. file`, `eval`), which mangles it into a 401.
- **2.4 [you] Cut over `api.huddle.fitness`.** DONE, the same as 1.3:
  - The certificate (`mc-worktrac-env-c-api-huddle-fitne-1107`) took ~6 minutes.
  - worktrac-deploy #103 recorded it, moved the alert rules to the new app (`prod.monitoring.bicepparam`
    `appName`), and put the deploy's health check and smoke test back on `api.huddle.fitness`.
  - Checked immediately before the change: nobody but the owner had signed in for over an hour.
  - **Rollback:** point the CNAME back to the old app. It still runs, with its certificate, and the
    TTL is 5 minutes.
- **2.5 Compare.** DONE: server-side `/me` p50 372 -> 17 ms. No errors, 5xx or slow syncs on the new
  app after the cutover. The owner's iOS 1.3.0 app worked.
- **2.6 [you] Delete the old prod app** once a week has passed with no rollback (Phase 3), and
  restore the 30-minute TTL.

## Phase 3 — cleanup

Done 2026-11-20 (worktrac-source cleanup PR, worktrac-deploy cleanup PR):
- Alerts: the prod rules watch `worktrac-backend-prod-cus` (worktrac-deploy #103).
- worktrac-deploy `infra-preview.yml` compares secrets against the new app names.
- `e2e/barrage/lib/config.mjs`: `LOWER.containerApp` is the new lower app.
- Log queries in `docs/azure-read-only-access.md` and `latency.md` match `startswith
  'worktrac-backend-<env>'`, so a window spanning the move reads as one series. `latency.md` records
  the measured result; `backend-core.md`'s N+1 rule no longer claims the regions differ.

**[you] From 2026-11-27**, once a week has passed with no rollback, one command at a time:
```powershell
az containerapp delete -g worktrac-rg -n worktrac-backend-lower --yes
```
```powershell
az containerapp delete -g worktrac-rg -n worktrac-backend-prod --yes
```
```powershell
foreach ($r in 'worktrac-backend-prod-5xx','worktrac-backend-prod-restarts','worktrac-backend-prod-memory','worktrac-backend-prod-replicas','worktrac-backend-prod-response-time') { az monitor metrics alert delete -g worktrac-rg -n $r }; az resource delete -g worktrac-rg -n worktrac-backend-prod-email-stuck --resource-type Microsoft.Insights/scheduledqueryrules
```
```powershell
az containerapp env delete -g worktrac-rg -n worktrac-env --yes
```
- Deleting `worktrac-env` takes its four managed certificates with it, including the two legacy
  `*.starnerconsulting.co` API names; their CNAMEs can then be removed from that domain's DNS.
- `interactive-timeline-env` is another project's environment; leave it alone.
- Namecheap: put the `api` and `api.dev` TTLs back to 30 minutes.
- Afterwards, `rg -n "worktrac-backend-(prod|lower)|worktrac-env"` across both repos should find
  only history.
