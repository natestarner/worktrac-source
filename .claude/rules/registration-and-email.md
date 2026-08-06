---
paths:
  - "backend/src/main/java/com/worktrac/backend/user/**"
  - "backend/src/main/java/com/worktrac/backend/email/**"
  - "backend/src/main/java/com/worktrac/backend/emaildelivery/**"
  - "backend/src/main/java/com/worktrac/backend/registrationaudit/**"
  - "backend/src/main/java/com/worktrac/backend/config/**"
  - "backend/src/main/java/com/worktrac/backend/common/**"
---

# Registration, auth & email-pipeline invariants

Full narrative: `docs/architecture/admin-portal.md`.

## Password reset is deliberately non-enumerating

`POST /api/auth/forgot-password` / `/reset-password` / `/resend-reset-code`
(`PasswordResetService`). A reset for an email with **no account** must return the exact same
response as a registered one: same `200`, same generic body, and it must consume the **same
rate-limit quota** — `checkSendAllowed` runs *before* the `existsByEmail` check, not after.
Gating it on the known-email branch would let an attacker distinguish known from unknown by
which emails eventually 429. Any new error message or "no account found" UI state must preserve
this indistinguishability.

## The async email pipeline must never silently swallow a task

This whole section exists because a real registration vanished with zero trace. See
`docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md`.

- `AsyncConfig`'s `emailTaskExecutor` uses **`CallerRunsPolicy`**, not the `ThreadPoolTaskExecutor`
  default (`AbortPolicy`, which silently drops a task when pool+queue saturate, with nowhere for
  an `@Async void` method's exception to go). Do not change this.
- `RegistrationEmailEventListener`'s four handlers isolate the **SEND attempt** from the **AUDIT
  WRITE** in separate try/catches (`sendAndRecord`/`recordSafely`). A failure persisting the
  *SENT* row must never be misreported as the email having failed — the send may have genuinely
  succeeded, and conflating them falsely triggers a "send failure" admin alert.
- `RegistrationAuditService.record` is **`REQUIRES_NEW`** — load-bearing. Several failure branches
  record-then-throw from a transaction that is not `noRollbackFor`-exempted; without its own
  transaction the audit row recording the failure would roll back with everything else.
- `RegistrationDispatchWatchdog` (`@Scheduled`, every 5 min) is the last-resort net for failure
  modes nobody anticipated. It's what makes "no blind spots" actually true rather than true only
  for the modes someone thought to `catch`.
- `AdminAlertEventListener` records `ADMIN_ALERT_FAILED` if an alert email itself fails —
  deliberately **not** in `RegistrationAuditService`'s `ALERTABLE` set, since an alert about a
  failed alert would recurse.
- Password-reset emails get identical SENT/FAILED audit coverage to registration emails.

**General rule:** an async dispatch mechanism must never have a code path where "the task didn't
run" and "the task ran and nothing went wrong" are indistinguishable from the outside.

## Two levels of email truth — never conflate

1. **Send accepted** — `EmailService.send` inspects ACS's `EmailSendResult.getStatus()`/
   `getError()` and throws `EmailSendException` on anything but `SUCCEEDED`; returns the ACS
   `messageId` on success.
2. **Actually delivered** — arrives later out of band via Event Grid
   (`Microsoft.Communication.EmailDeliveryReportReceived`) → `EmailDeliveryWebhookController`,
   correlated by that same `messageId`. Its `permitAll()` route is gated by a shared-secret query
   param (`EMAIL_DELIVERY_WEBHOOK_KEY`). A new environment needs its own Event Grid subscription
   or these events never arrive.

Every failure event's `detail` carries the **real reason** (ACS code, the recipient server's SMTP
diagnostic, the specific rate limiter), not just an event-type label.

## Registration observability

- Every lifecycle step is persisted as a `RegistrationEvent` (V44). A request that never reaches
  `RegistrationService` at all is captured as `UNEXPECTED_ERROR` from `GlobalExceptionHandler`.
  This does **not** cover a full outage — recording an event is itself a DB write.
- Extracting the email there needs
  `WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class)`, **not** a plain
  `instanceof` check — Spring Security wraps the request in further layers in between.
- No admin "resend" action exists, on purpose: a stuck pending registration isn't a real account
  yet, so re-registering the same email already works.

## JWT role claim

`JwtService` carries the role; `JwtAuthenticationFilter` builds the authority from it. A token
minted before the claim existed parses with role defaulting to **`USER`**, not failing closed to
`ADMIN`. **Never invert that default.**
