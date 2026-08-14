# Resilience: one code path for every condition

The short, enforceable version of this document is `.claude/rules/resilience.md`, which auto-loads
when you touch product code. This is the "why".

## The contract

**The app behaves the same whether it is online, on lie-fi, hard offline, pinned offline, or
talking to a backend that is cold-starting, DB-less, overloaded, or mid-deploy.** Degradation is
the default case, not an edge case. A failure degrades to *queue and retry* or *show what's
cached* — never to signed-out, blank, silently-lost, or an indefinite spinner over a request that
will never succeed.

That is not an aspiration bolted on afterwards; it is what the existing architecture already does.
The frontend has one mutation scope, one retry predicate, two enqueue choke points, one immutable
ordering key, and one connectivity source of truth. The backend's contribution is deliberately
narrow: answer an honest 503, never let an outage become a 401, and dedupe on `client_key` so the
client can retry forever.

## Why this document exists

By 2026-08 the repo had 15 post-mortems in `docs/incidents/` — but only about six distinct
mechanisms behind them. Five were the same persisted-cache-restore race. Three were the same
outbox-ordering bug, shipped as a fix, then a fix for the fix, then a third bug in the same file.
PRs #96→#99 were four consecutive attempts at one bug, with #97 and #98 each recording in their
own commit body that the previous attempt "wasn't sufficient and the same lower e2e test still
failed 3/3 after shipping it."

The invariants were all written down. The problem was that they were only written down. Every fix
was verified by reasoning about the other conditions rather than by running them, and reasoning is
what kept regressing — especially since five separate incidents passed locally and failed only on
lower, where the timing, the service worker, and real latency exist.

So the response is three-layered, in ascending order of durability:

1. **Stated once** — the contract in `CLAUDE.md`, the checklist in `.claude/rules/resilience.md`.
2. **Enforced mechanically** — `scripts/check-resilience-invariants.sh`, run by CI and by the
   session `Stop` hook. Modeled on `scripts/check-jdk-alignment.sh`, which exists for exactly the
   same reason: trusting review to catch a repeat is how the repeat happens.
3. **Asserted by tests** — `e2e/tests/support/parity.ts` runs one assertion body across
   connectivity modes, so "behaves the same online and offline" is a test result rather than a
   claim in a comment.

Documentation is the *weakest* of the three, which is why it is the thinnest layer here.

## The four axes

Grouped this way because they fail independently — a change can be correct on one axis and wrong
on another, and the axes compose (a reload *during* lie-fi *after* a schema change is three rows
at once, and is precisely what several incidents were).

### A. Reachability — what the network does

Three connectivity states, not two, and the third is not a degenerate case of the others:

- **Online.**
- **Lie-fi** — the backend is unreachable or erroring while `navigator.onLine` still reports
  `true`. Detected by `reachabilityMonitor.js` counting consecutive **rejected** fetches; a real
  completed response — *even a 4xx or 5xx, because the server answered* — resets the counter.
- **Offline** — auto hard-offline, or the user-elected manual pin.

**Hard offline and the pin are different states.** The pin (`lib/offlineMode.js`) drives
`onlineManager` *and* swaps its event listener for a suspended no-op, so a browser `online` event
cannot silently un-pin. It survives reload and is only ever exited by the user, after
`probeReachability()` succeeds. A change verified with `context.setOffline()` has not been
verified under a pin.

**Slow-but-alive** deserves its own row: `api/client.js` aborts at `REQUEST_TIMEOUT_MS`, so a
backend that is merely slow is indistinguishable from a dead one at the client. That is the right
trade — an unbounded request is how lie-fi becomes undetectable — but it means server latency
converts into a connectivity state.

### B. The server answers, but not with success

The crucial asymmetry: **a fulfilled 5xx does not trip lie-fi.** The server answered, so
`recordSuccess()` runs and the consecutive-failure counter resets. A cold-starting Container App
returning 503 is therefore a *different* code path from an unreachable one, not a variant of it.
Both must work; neither implies the other has been tested.

Pool exhaustion is the same shape from the other end: Hikari's default max is 10 and lower/prod
set `connection-timeout: 60000`, so under load a request hangs past the client's abort and a
*busy* server presents to the browser as lie-fi. `e2e/playwright.config.ts` pins `workers: 2`
specifically because higher concurrency reproduced this against the local stack.

For DB-down-but-container-up, the load-bearing invariant is `backend-core.md`'s: an escaped
exception re-dispatches through `/error`, re-runs the security chain as anonymous, and turns an
outage into a 401 that logs the user out. `GlobalExceptionHandler` must answer every failure
honestly (400/503/500) for that reason — see `docs/incidents/2026-07-27-db-outage-forced-logout.md`.

### C. Client lifecycle — what the device does

The query persister is throttled at 1s, and `swUpdate.js`'s `tryForceUpdate` silently reloads on
ordinary navigation whenever a new service-worker build exists — which is *always true just after
a deploy*. Those two facts together are the single most productive bug source in this codebase's
history: a reload landing inside the throttle window boots from a snapshot taken before the most
recent cache change. It produced an ended workout coming back to life
(`2026-08-08-ended-workout-resurrected-by-persisted-cache.md`) and a just-created routine
vanishing for minutes (`2026-08-08-restored-cache-looks-fresh.md`).

The general rule that came out of it: **any cache entry whose staleness would be actively wrong
rather than merely old cannot rely on the query cache alone.** `endedSessions.js` is the pattern —
a synchronous localStorage marker written before the cache clear, which a reload cannot outrun.

Storage being unavailable (private mode, quota, disabled) is a real condition the persistence
modules already handle by degrading to in-memory, and is the least-tested row on the matrix.

### D. State restored from an earlier world

Not network conditions, but the identical failure class — state arriving from a moment when the
code was different:

- A persisted `byPerson` slice predating a new field hydrates it as `undefined` unless `HYDRATE`
  underlays `PERSON_DEFAULTS`. This white-screened the Trends tab on hover
  (`2026-08-08-trends-hover-blank-page.md`). **Test the upgrade path, not a fresh profile** — a
  brand-new person never reproduces it.
- A rehydrated query keeps the `dataUpdatedAt` it had when persisted, so it claims to be seconds
  old and satisfies every staleness check. Freshness is not correctness.
- A dependent write can resolve against a temp id that hasn't mapped yet — which is why
  `requireResolvedExerciseId` throws a **status-less, therefore retryable** error rather than
  POSTing `temp-exercise-<uuid>` to a `Long` field.

## Divergence is allowed — but it is a closed list

Some behavior genuinely must differ by condition. Tier-3 writes refuse to queue offline because
some of them (`createPastSession`) are **not idempotent** and would duplicate on replay. That is a
correct divergence, and deleting it would be a bug.

The closed list lives in `.claude/rules/resilience.md` because that is what auto-loads. The point
of making it a list is that it turns "is this branch legitimate?" from a judgement call into a
lookup: **a connectivity branch that is not on the register is a bug until someone adds it with a
reason.** That is also what stops the seesawing — several past regressions were a later change
"simplifying" a divergence that existed on purpose.

Two entries are worth repeating here because they read like bugs and are not:

- **`useOnlineStatus` never reflects lie-fi.** Tier-3 gating reads it, and during lie-fi the
  server may still be answering — disabling those controls would be wrong.
- **DB down, backend up:** a *pinned* user cannot unpin, because `probeReachability()` hits
  `/actuator/health`, which correctly reports 503 when the DB is unreachable. An *unpinned* user
  in the same outage stays in plain "online" mode, because a 503 is a fulfilled response and never
  trips lie-fi. Both degrade correctly, by different routes. Neither should be changed to match
  the other, and the aggregate health endpoint should keep returning 503 — it is the honest answer
  for the deploy gate and for observability.

## Known gaps

Recorded here rather than fixed silently, so they are visible to the next person:

- **Playwright does not run in this repo's branch CI.** `.github/workflows/ci.yml` runs backend
  and frontend suites only; the sole pre-merge e2e gate is the local run in `/deploy-to-lower`,
  and the deployed suite runs post-merge from `worktrac-deploy`'s `deploy-lower.yml`. Moving e2e
  into branch CI is a shared-infra decision with its own cost profile.
- **Storage-unavailable is largely untested.** The swallow-and-degrade paths exist and are
  commented, but almost nothing exercises them.
- **A set logged during lie-fi or while pinned offline disappears from "This session" after a
  reload**, even though it reached the server (the summary and Est. 1RM both show it). Online and
  hard-offline repopulate correctly; only the two modes where the session never had a server id
  fail. Found by the parity harness on its first run and reproducible at `--workers=1`; recorded
  as a `fixmeModes` entry in `e2e/tests/parity-active-loop.spec.ts` with the full reproduction.
  Consistent with two documented mechanisms compounding — `contextSessionId` staying null for the
  whole degraded stretch, and a rehydrated cache entry keeping its old `dataUpdatedAt` while
  `sessionSets` is session-scoped and therefore neither cache-warmed nor on the
  `refreshAfterRestore` list. Deliberately not fixed blind: it sits in the
  ExerciseDetail/queryClient logic that produced most of `docs/incidents/`.

- **One spec fails intermittently on an untouched tree**: `rest-timer-setting.spec.ts` →
  *"…shown together on one screen"*. Fails on some runs and passes on others, with and without
  changes. Recorded here so the next person doesn't spend an hour attributing it to their own diff.

  `offline-durability.spec.ts` → *"cold-loads from cache and boots the saved session while fully
  offline"* **was** listed here alongside it as rot from those specs having run nowhere. That was
  wrong twice over: it was a harness bug, not rot, and the app was behaving correctly the whole
  time. `context.setOffline` does not survive into the document a reload creates, so the spec was
  asserting the offline banner while measuring lie-fi. Fixed 2026-08-14 —
  `docs/incidents/2026-08-14-cold-boot-offline-spec-measured-liefi.md`. **A known-failure note is a
  liability**: this one made a real red look expected for four days, and the next diagnosis reasoned
  only about product code because the note framed it as the app's fault.

### Checked and closed

- **The Azure Container Apps liveness probe is NOT a hazard.** The concern was that pointing a
  liveness probe at `/actuator/health` would make a DB outage fail liveness on every replica at
  once, so Container Apps would restart them all — turning a recoverable degraded state into a
  crash-loop, since restarting never fixes a DB outage. Verified 2026-08-10 via the read-only
  service principal: `az containerapp show --query "properties.template.containers[].probes"`
  returns `[]` for **both** `worktrac-backend-lower` and `worktrac-backend-prod`. No probes are
  configured, so Container Apps falls back to its default TCP check, which is unaffected by DB
  state. **If a probe is ever added, do not point liveness at `/actuator/health`** — use Spring
  Boot's `management.endpoint.health.probes.enabled` and the `/actuator/health/liveness` group.
- **`shouldRetryWrite` treating every 4xx as definitive** — fixed. `408 Request Timeout` and
  `429 Too Many Requests` are now retryable, since both explicitly mean "try again" and dropping a
  durable write on either violates the core invariant. The boundary is tested on both sides so the
  carve-out cannot widen into "retry all 4xx", which would head-of-line-block the serial outbox
  scope forever.
