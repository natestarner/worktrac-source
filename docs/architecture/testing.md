# Testing

- Backend: JUnit 5 + Spring Boot Test
- Frontend: Vitest + React Testing Library
- E2E: Playwright (run against deployed lower environment)
- Minimum: write tests for any new endpoint or user-facing feature
- Every backend integration test (Spring context + database) extends
  `backend/src/test/java/com/worktrac/backend/support/AbstractIntegrationTest.java`, which
  starts ONE singleton `MSSQLServerContainer` for the whole JVM instead of each class starting
  its own (24 classes used to mean 24 containers — the multi-container approach is what
  originally crashed on `fs.aio-max-nr` and forced `parallelism=1`; see git history on
  `junit-platform.properties`). Each class still gets its own isolated database on that one
  container (via a `@DynamicPropertySource` method calling `registerDatasource`), so per-class
  data isolation is unchanged. This alone is the bulk of the real speedup (one container start
  instead of 24) and holds regardless of the parallelism setting below. `bash
  scripts/test-backend.sh unit` runs just the ~10 non-container unit test classes (no DB, no
  Spring context, seconds not minutes) via Surefire's `-DexcludedGroups=integration`; `bash
  scripts/test-backend.sh` (or plain `mvn verify`) runs everything.
- **Class-level parallelism (`junit-platform.properties`) is deliberately back at 1**, not the 4
  it briefly was, after TWO independent, real concurrency bugs surfaced empirically:
  1. Spring Boot's `LogbackLoggingSystem` resets the JVM-shared Logback `LoggerContext` on
     every new Spring context's startup, silently detaching a manually-attached test log
     appender (`LogCaptor`, used by `AuthControllerRateLimitTest`) if another class's context
     boots concurrently. Confirmed via a debug build capturing attachment state at assertion
     time. A reset-resistant `LoggerContextListener` re-attach hook did NOT reliably fix it
     (more than one wipe can land in sequence) — fixed instead by marking that one class
     `@Isolated` (`org.junit.jupiter.api.parallel.Isolated`), so nothing else executes
     concurrently with it. If a future test needs `LogCaptor`, mark it `@Isolated` too rather
     than relying on cross-request log ordering/content under parallelism.
  2. A SECOND, independent Mockito `UnfinishedStubbing` failure surfaced in
     `PasswordResetControllerTest` on the real CI runner — never once across 8+ consecutive
     local runs, suggesting it's sensitive to CI's specific core count/scheduling rather than
     reliably reproducible for a local fix-and-verify cycle. Root cause not yet confirmed
     (plausibly Mockito's inline-mock-maker bytecode instrumentation — a JVM-wide, not
     per-thread, mechanism — racing across multiple classes' `@MockitoBean` setup during
     concurrent context refresh).
  Re-enabling parallelism again needs: (a) root-causing the Mockito failure with certainty
  (reproducible outside CI), (b) auditing the other 23 classes for the same two failure
  classes, not just this pair, (c) several green **CI** runs (not just local) at the target
  parallelism before trusting it as a required check.
- **Connectivity-mode e2e helpers** (`e2e/tests/support/`): `offline.ts` (banner/outbox
  locators, `goHardOffline`/`goOnline`) and `faults.ts` (`failNetwork` — a rejected fetch, the
  only thing that drives lie-fi detection — vs. `failWithStatus` — a fulfilled 4xx/5xx, which
  does not). Use these instead of ad hoc `context.setOffline`/`page.route` calls so new specs
  stay consistent with which fault type actually exercises which code path (see Offline Mode
  Notes above). Service-worker-dependent specs (cold boot, reload-while-offline) live in
  `offline-durability.spec.ts` and run only via `cd e2e && npm run test:pwa`
  (`playwright.pwa.config.ts`), never the fast default project.
- **`live-email-canary.spec.ts` is the one spec that triggers a real ACS send** — see the
  Admin Portal Notes' "Delete all e2e test data" entry above for why every other spec's
  registration is now no-op'd instead. `registerHousehold` (`auth.ts`) takes an optional
  `emailOverride` for this reason; every other call site should keep using its default-generated
  `huddle+e2e-...` address, not pass one in.
- **`bash scripts/e2e.sh` runs the suite against THIS worktree's own stack** (bringing it up
  first via `scripts/up.sh` if isolated per-worktree stacks are wired up; otherwise falls back
  to assuming the historical fixed-port stack is already running). A **global teardown**
  (`e2e/tests/support/globalTeardown.ts`, wired into `playwright.config.ts`) calls the existing
  `DELETE /api/admin/test-data` after every LOCAL run so repeated runs don't accumulate
  `huddle+e2e-...` accounts — it bootstraps (or logs into) the default admin account itself and
  is deliberately a no-op against any non-`localhost` `baseURL` (a real address on the team's
  domain, `nate+huddleadmin@starner.co` by default, would otherwise be registered/logged into
  for real against a deployed target). Never fails the run itself — any error is logged and
  swallowed, since cleanup is a hygiene nicety, not a correctness gate.

