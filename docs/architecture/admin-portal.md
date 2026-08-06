# Auth & Admin Portal Notes

## Auth Notes
- **Password reset (`POST /api/auth/forgot-password`, `/reset-password`,
  `/resend-reset-code`) is deliberately non-enumerating** — see `PasswordResetService.java`.
  Requesting a reset for an email with no account must return the exact same response as a
  registered one: same `200`, same generic body, and it must consume the same rate-limit
  quota (`checkSendAllowed` runs *before* the `existsByEmail` check, not after — gating it
  only on the known-email branch would let an attacker distinguish "known" from "unknown" by
  which emails eventually 429 under repeated requests). Any future change to this flow
  (new error message, a "no account found" UI state, etc.) must preserve that indistinguishability.
- **Registration is fully audited** (`registration_events` table, `V44`,
  `com.worktrac.backend.registrationaudit` package) — see Admin Portal Notes below for what
  this makes visible and how email delivery truth is captured end-to-end.

## Admin Portal Notes
- **`ADMIN_EMAILS` (an env var wired per-environment in the `worktrac-deploy` repo) is the
  real source of truth for who is an admin** — `users.role` (`'USER'`/`'ADMIN'`) is only a
  cache of it, never edited by hand. It's reconciled in two places:
  - `AuthService.login` — promotes or demotes on every login, so removing someone from the
    allowlist takes effect on their next login without a redeploy.
  - `AdminBootstrap` (an `ApplicationRunner`) — promotes any already-registered listed user
    once at startup, so a freshly added `ADMIN_EMAILS` entry doesn't require that person to
    log out and back in first. It never demotes; only login does.
  - `RegistrationService.confirmEmail`'s auto-login does **not** reconcile — a brand-new
    admin-allowlisted registration is still `USER` until their first explicit `/api/auth/login`.
  - The JWT carries the role as a claim (`JwtService`); `JwtAuthenticationFilter` builds the
    Spring Security authority from it. A token minted before this claim existed parses with
    role defaulting to `USER`, not failing closed to `ADMIN` — never invert that default.
- **`/api/admin/**` is gated at the route level** (`SecurityConfig` → `hasRole("ADMIN")`),
  not per-controller-method — `AdminController`/`AdminService` are the one place in the app
  that deliberately reads across every account instead of scoping to
  `CurrentUser.accountId()`. Admin DTOs must never include `password_hash`,
  `pending_registrations.code_hash`, or any hashed value — curate every field added to them.
- **Read-only, with exactly two narrow, sanctioned exceptions** (any future admin action that
  touches app data needs the same explicit sign-off these two got):
  1. `PUT /api/admin/registration-alert-settings` (below) — alerting *configuration*, not
     application data.
  2. `DELETE /api/admin/test-data` (below) — genuinely deletes rows, but only ones matching the
     e2e suite's own exact, unmistakable email pattern; see its own entry for the full safety
     design.
- **Registration observability (`registration_events` table, `V44__create_registration_events.sql`,
  `com.worktrac.backend.registrationaudit` package) — added 2026-07-31 after a production
  registration silently failed with zero trace anywhere.** Every step of the registration
  lifecycle — form submitted, duplicate/rate-limited/locked/expired/wrong-code, confirmed +
  account created, and the email outcome — is persisted as a `RegistrationEvent`
  (`RegistrationAuditService.record`, called from `RegistrationService` and
  `RegistrationEmailEventListener`). `REQUIRES_NEW` on `record()` is load-bearing: several
  failure branches record-then-throw from a transaction that is NOT `noRollbackFor`-exempted
  (unlike `confirmEmail`'s wrong-code branch), so without its own independent transaction the
  audit row recording the very failure would be rolled back along with everything else.
  Surfaced in the admin portal's **Activity** tab (full feed, `GET
  /api/admin/registration-events`, with a legend explaining event colors and the send-vs-delivered
  distinction) and folded into the **Pending** tab as a per-row email delivery-status badge +
  expired flag.
  - **A request to `/api/auth/register`/`confirm-email`/`resend-code` that never reaches
    `RegistrationService` at all is also captured**, as `RegistrationEventType.UNEXPECTED_ERROR` —
    a malformed body, a Bean Validation failure, a `DataAccessException`, or anything else
    `GlobalExceptionHandler` had to catch, with the real cause in `detail`. This does **not**
    cover a genuine full outage (DB down / container crashed) — recording an event is itself a
    database write, so if the database is unreachable there's nothing to record with; that class
    of failure is only visible via Azure's own Container App log stream. Extracting the email for
    this case needed `WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class)`, not
    a plain `instanceof` check — confirmed by a real test failure without it: Spring Security
    wraps the request in further layers between `AuthRequestLoggingFilter` (which populates the
    `ContentCachingRequestWrapper` in the first place) and `GlobalExceptionHandler`, so the object
    a `@ExceptionHandler` method actually receives is not that wrapper directly, only something
    wrapping it.
  - **Two levels of email truth, both captured, never conflated:** (1) *send accepted* —
    `EmailService.send` now inspects ACS's own `EmailSendResult.getStatus()`/`getError()`
    instead of discarding it, throwing `EmailSendException` with the real ACS code/message on
    anything but `SUCCEEDED`, and returns the ACS `messageId` on success. (2) *actually
    delivered* — the ACS send being accepted does **not** mean the recipient ever got it; that
    truth arrives later, out of band, via Azure Event Grid's
    `Microsoft.Communication.EmailDeliveryReportReceived` events, ingested by
    `EmailDeliveryWebhookController` (`POST /api/webhooks/email-delivery`,
    `com.worktrac.backend.emaildelivery` package) and correlated back to the original send via
    that same `messageId`. The webhook's `permitAll()` route (`SecurityConfig`) is gated
    instead by a shared-secret query param (`EMAIL_DELIVERY_WEBHOOK_KEY`, wired per-environment
    in `worktrac-deploy` — see `EmailDeliveryWebhookProperties`), since Event Grid is a
    server-to-server caller with no JWT. **Requires an Azure Event Grid subscription on the
    ACS resource pointing at this webhook to actually receive delivery reports** — set up for
    both lower (`worktrac-comms-lower-topic`) and production (`worktrac-comms-prod-topic`,
    added 2026-08-02 alongside the registration-observability feature's promotion to
    production) as of this writing; setup steps recorded in `../worktrac_SDLC_setup_guide.md`
    section 21. A future third environment would need the identical two-step
    `az eventgrid system-topic create` + `az eventgrid system-topic event-subscription create`
    (the dedicated subcommand — the generic `event-subscription create --source-resource-id`
    does not work against this resource type) against its own ACS resource before its
    `EMAIL_DELIVERED`/`EMAIL_BOUNCED`/etc. events would ever arrive.
  - **Every failure event's `detail` carries the real reason**, not just an event-type label:
    ACS error code/message for a send failure, the recipient server's actual SMTP diagnostic
    (`deliveryStatusDetails.statusMessage`, e.g. `"550 5.1.1 mailbox does not exist"`) for a
    delivery failure, and the specific cause (which rate limiter, attempt number, etc.) for a
    flow failure.
  - **Alerting is admin-configurable, not hardcoded** — `registration_alert_settings`
    (single seeded row, `V45__create_registration_alert_settings.sql`), three toggles (new
    registration confirmed / send failure / delivery failure — the latter two default ON,
    confirmed defaults OFF), read/written via `GET`+`PUT
    /api/admin/registration-alert-settings` and the Activity tab's settings panel.
    `AdminAlertEventListener` reacts to a `RegistrationAlertEvent` (published by
    `RegistrationAuditService.record` for the alertable subset of event types) and, if the
    matching toggle is on, emails every `ADMIN_EMAILS` address via
    `EmailService.sendAdminAlert`. An alert-send failure is logged only — there is no
    "alert about a failed alert" escalation.
  - **No admin "resend" action was added, on purpose.** A stuck pending registration isn't a
    real account yet (no `users` row), so re-registering the same email already works —
    `register()` only checks `users`, not `pending_registrations`, and replaces the stale
    pending row with a fresh code. Adding a resend button would have been redundant.
- **The async email-dispatch pipeline itself can never silently swallow a task — see the
  2026-08-01 blind-spots incident below.** `AsyncConfig`'s `emailTaskExecutor` uses
  `CallerRunsPolicy`, not the `ThreadPoolTaskExecutor` default (`AbortPolicy`, which silently
  throws/drops a task when the pool+queue are saturated with nowhere for a `@Async void`
  method's exception to go). `RegistrationEmailEventListener`'s four handlers (verification
  code, registration success, password-reset code, password-reset success — all four now
  covered identically, see below) isolate the SEND attempt from the AUDIT WRITE in separate
  try/catches (`sendAndRecord`/`recordSafely`): a failure while persisting the *SENT* audit row
  itself must never be misreported as the email having failed, since the send may have
  genuinely succeeded — conflating the two would falsely trigger a "send failure" admin alert
  for an email that actually went out. `AdminAlertEventListener` records `ADMIN_ALERT_FAILED`
  (not just a log line) if the alert email itself fails to send — deliberately not in
  `RegistrationAuditService`'s `ALERTABLE` set, since an alert about a failed alert would
  recurse. `RegistrationDispatchWatchdog` (`@Scheduled`, every 5 minutes, `SchedulingConfig`
  enables `@EnableScheduling` app-wide) is the last-resort safety net for failure modes nobody
  has specifically anticipated: it queries for any `REGISTER_STARTED` with no
  `VERIFICATION_EMAIL_SENT`/`FAILED` recorded within a 2-minute grace period and records
  `REGISTRATION_EMAIL_DISPATCH_MISSING` (alertable, reuses the `alertOnSendFailure` toggle) —
  this is what makes "no blind spots" actually true rather than true only for failure modes
  someone thought to `catch`.
  - **Password-reset emails (`PasswordResetService`) get the identical SENT/FAILED audit
    coverage** as registration emails (`PASSWORD_RESET_EMAIL_SENT/FAILED`,
    `PASSWORD_RESET_SUCCESS_EMAIL_SENT/FAILED`) — previously these had zero audit trail at all,
    only a bare `log.error`, which was itself an undiagnosed blind spot in a sibling flow.
- Frontend: `AdminRoute` redirects a non-admin (even if authenticated) to `/app/log` rather
  than showing an access-denied screen, so the portal's existence isn't revealed to ordinary
  users. It's a standalone layout (`AdminShell`) under `/admin`, not a tab inside the
  workout app's `AppShell`/`TabsNav`. Tabs: Overview, Accounts, People, Pending, **Activity**.
  `AdminShell` also mounts `Toast`/`ConfirmDialog` (unlike the rest of `AppShell`'s globals,
  which are workout-specific and irrelevant here) — needed by the test-data cleanup action
  below; without them, `openConfirm()`/`showToast()` called from an admin route would update
  `UIContext` state that nothing in the admin tree ever renders.
- **"Delete all e2e test data" (`DELETE /api/admin/test-data`, `com.worktrac.backend.admin`'s
  `TestDataCleanupService`/`TestDataAdminController`) — the second deliberate exception to the
  read-only-admin-portal rule.** Lets an admin wipe every trace of the Playwright e2e suite's
  own data on demand, from a button on the Activity tab, to clear the noise it leaves in
  Accounts/Pending/Activity.
  - **Identification matches two precise patterns, not a heuristic:** every one of this repo's
    e2e specs creates its test households through exactly one shared helper
    (`e2e/tests/support/auth.ts`'s `registerHousehold`), which always generates emails as
    `huddle+e2e-<timestamp>-<random>@starner.co` — a plus-addressed sub-address of a real mailbox
    the team controls, filed into its own folder by a mail rule on the `huddle+e2e-` prefix.
    **Switched 2026-08-02 from `e2e-<...>@example.com`**: that IANA-reserved (RFC 2606) domain
    could never resolve to a real mailbox, so *every* e2e-generated registration bounced —
    harmless to the app itself, but each bounce still counted against the sending domain's ACS
    reputation, and volume only grows as deploys get more frequent. A genuine user would need to
    both own `huddle@starner.co` and choose to register with this exact synthetic local part, so
    `TestDataCleanupService.CURRENT_EMAIL_PATTERN` (`huddle+%@starner.co` —
    `findAccountIdsByEmailLike`/`countByEmailLike` on `UserRepository`,
    `RegistrationEventRepository`, `PendingRegistrationRepository`) still can never accidentally
    match a genuine user's account. Deliberately broader than just the `huddle+e2e-` prefix
    (see below) so it also catches `live-email-canary.spec.ts`'s `huddle+livewiretest-...`
    address. `LEGACY_EMAIL_PATTERN` (`e2e-%@example.com`) is retained alongside it so any
    pre-2026-08-02 backlog already sitting in a database can still be cleaned up. **The e2e
    helper's pattern and both of `TestDataCleanupService`'s patterns must always change
    together** — they're independently-maintained copies of the same literal strings, not
    derived from one shared constant.
  - **Real ACS traffic from e2e is now a single, deliberate exception, not every registration.**
    `EmailProperties.e2eNoopRecipientPattern` (a regex, set only in `application-local.yml`/
    `application-lower.yml` — empty, and therefore inert, in production) makes
    `EmailService.send()` skip the real Azure Communication Services call entirely whenever
    every recipient matches it, returning a synthetic `"noop-<uuid>"` messageId instead.
    Everything above that one network call — `RegistrationEmailEventListener`,
    `RegistrationAuditService`, the Activity tab — still runs for real, so a no-op'd send is
    still fully visible in the audit trail as an ordinary `VERIFICATION_EMAIL_SENT`. The
    configured pattern only matches the `huddle+e2e-` prefix (not the whole `huddle+%@starner.co`
    cleanup namespace), so `e2e/tests/live-email-canary.spec.ts`'s `huddle+livewiretest-...`
    address deliberately falls through to a real send every time — the one spec proving the real
    registration → email pipeline still works end to end, since every other spec's registration
    is now free (no real ACS call, no real bounce/reputation exposure). That spec can't just
    check that the UI reached `/app/log` (the verification code is written to a local cache
    synchronously, independent of whether the async send that follows succeeds, fails, or gets
    no-op'd) — it polls a new test-support endpoint, `GET /api/auth/test/email-outcome`
    (`TestSupportController`, gated identically to the existing `pending-code` endpoint), which
    reads the real `VERIFICATION_EMAIL_SENT`/`FAILED` event back from `registration_events`.
  - **Genuine bulk SQL deletes, not a per-account loop — fixed 2026-08-01 after a real lower
    timeout.** An earlier version looped `AccountDeletionService.deleteAccount(Long)` once per
    matching account; Spring Data JPA's derived `deleteByAccount_Id`/`deleteByEmailLike` methods
    (used by that per-account cascade) load and remove every matching entity one at a time
    rather than issuing a single `DELETE` statement, so once lower had accumulated hundreds of
    e2e accounts across repeated deploys' e2e runs, one click took long enough to exceed the
    frontend's request timeout — and the client timing out did **not** cancel the still-running
    backend transaction, whose DB load is suspected to have contributed to the async
    email-dispatch blind spot described above. `deleteAll()` now issues one bulk
    `DELETE ... WHERE account_id IN (...)` (or `email LIKE ...`) per table across every matching
    account at once (`deleteByAccountIdIn` on `PersonRepository`/`ExerciseRepository`/
    `TagRepository`/`UserRepository`, `deleteByEmailLikeBulk` on
    `RegistrationEventRepository`/`PendingRegistrationRepository`, and Spring Data's own
    `deleteAllByIdInBatch` for `accounts`) — order still matters for the same FK reasons as
    `AccountDeletionService` (untouched, still the real single-account self-service-delete
    path). The frontend's `deleteTestData()` call also carries its own longer `timeoutMs`
    (60s vs. the shared 15s default, via `apiClient.delete`'s new options parameter in
    `client.js`) as a second line of defense.
  - **The real safety net is `TestDataAdminController`'s `@Profile({"local", "lower"})`** —
    identical two-layer defense to the e2e test-support endpoint (`TestSupportController`): these
    routes don't exist as Spring beans at all outside local/lower, so this can never run in
    production even by mistake, regardless of what the UI does or doesn't hide. Still gated by
    the existing `/api/admin/** → hasRole('ADMIN')` rule in `SecurityConfig` on top of that.
  - **Preview before delete, not just a generic confirm.** `GET
    /api/admin/test-data/preview` returns the same `AdminTestDataPreviewDto` (account count,
    registration-event count, pending-registration count) that the `DELETE` call itself
    returns, so the Activity tab's button shows the admin exactly what's about to go inside the
    shared global `ConfirmDialog` before they commit — a deliberate, discussed choice over a
    plain "are you sure?".

