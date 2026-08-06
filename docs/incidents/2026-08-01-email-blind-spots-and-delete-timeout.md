# A registration's verification email vanished with zero trace, and the test-data-cleanup delete timed out (2026-08-01)

- User testing in lower hit two issues in one session: (1) clicking "Delete all e2e test data"
  timed out client-side with the data never actually deleted, and (2) registering
  `nate+2@starner.co` showed `REGISTER_STARTED` in the Activity tab with **no** corresponding
  `VERIFICATION_EMAIL_SENT`/`FAILED` event ever appearing, and no OTP email arrived — "It seems
  to have gone into a blackhole."
- Root cause of (1): `TestDataCleanupService.deleteAll()` (added in PR #113) looped
  `AccountDeletionService.deleteAccount(Long)` once per matching e2e account. Spring Data JPA's
  derived `deleteByAccount_Id`/`deleteByEmailLike` methods that cascade calls (used there)
  select every matching entity and remove it one at a time rather than issuing a single `DELETE`
  statement — fine for one account, but lower had accumulated hundreds across repeated deploys'
  e2e runs, and the resulting total round trips exceeded the frontend's 15s request timeout.
- Root cause of (2), and how it connects to (1): the client timing out does **not** cancel the
  backend's still-running transaction — that long-running, DB-heavy delete is suspected to have
  contributed to `AsyncConfig`'s `emailTaskExecutor` (a small bounded `ThreadPoolTaskExecutor`)
  hitting its queue capacity at the same moment a real registration's verification-email
  dispatch was submitted. The executor's default `RejectedExecutionHandler` is `AbortPolicy`,
  which throws a `TaskRejectedException` with nowhere for an `@Async void` method to route it —
  the task simply never ran, and because `RegistrationEmailEventListener`'s SENT/FAILED
  audit-recording code lives *inside* that task body, nothing was ever written to
  `registration_events` for it. `REGISTER_STARTED` alone had already committed synchronously
  inside `register()`'s own request thread, which is why that one event *did* show up.
- Investigating this surfaced a second, independent, previously-latent bug while reviewing the
  same listener: if a send genuinely *succeeded* but the subsequent `VERIFICATION_EMAIL_SENT`
  audit-write itself then threw (a transient DB hiccup at that exact moment), the single
  try/catch wrapping both calls would catch that exception and record `VERIFICATION_EMAIL_FAILED`
  instead — silently misreporting a successfully-delivered email as failed, which would also have
  falsely triggered an admin "send failure" alert for an email that actually went out fine.
- **Takeaway, per an explicit, broader user mandate ("every part of the registration process
  needs appropriate logging/visibility/alerting — no blind spots where it's unknown what
  happened"):** rather than patching just the one reported scenario, the whole pipeline was
  audited end to end and hardened at every layer described in the Admin Portal Notes entries
  above — `AsyncConfig`'s `CallerRunsPolicy` (a saturated queue can never again drop a task
  silently), `RegistrationEmailEventListener`'s send/audit-write separation (a failure to persist
  can never be misreported as a send failure), `RegistrationDispatchWatchdog`'s periodic
  reconciliation (a safety net for failure modes nobody has specifically anticipated, not just
  the ones with their own `catch` block), `ADMIN_ALERT_FAILED` visibility (an alert that itself
  fails to send is no longer only a log line), identical audit coverage extended to the
  previously-uninstrumented password-reset email flow, and `TestDataCleanupService`'s genuine
  bulk-delete rewrite (plus a longer, dedicated frontend timeout as a second line of defense).
  The general lesson, consistent with the durable-outbox principle already established for
  offline writes: an async dispatch mechanism must never have a code path where "the task didn't
  run" and "the task ran and nothing went wrong" are indistinguishable from the outside. Full
  investigation narrative: `git log --grep="blind spot\|CallerRunsPolicy\|DISPATCH_MISSING" -i`.

