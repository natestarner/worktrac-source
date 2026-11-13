# ACS stopped confirming sends, and the app resent every accepted email (2026-11-12)

## Symptom

During a sign-up/delete test on production, the admin inbox got `SUCCESS_EMAIL_FAILED` for a
Google and an Apple account, then `EMAIL_BOUNCED` for the Apple private-relay address. Every
production email that evening logged five attempts, each ending in
`ReactiveException: TimeoutException: Polling didn't complete before the timeout period.`, and
then "Gave up ... (after 5 attempts)". The alert emails reporting those failures failed the same
way, yet arrived. The "failed" welcome email reached Gmail at 06:56 UTC the next morning, about 10
hours after it was sent. Lower and local showed the same timeouts, and the `@critical`
`live-email-canary.spec.ts` went red on every lower deploy.

## Root cause

Two independent things, and only the second was ours.

1. **Azure Communication Services slowed down.** From about 18:00 UTC on 2026-11-12, ACS accepted
   every send at once (`SendMail` → 202, 100% in the resource metrics) but kept it `Running` for
   hours. Status polls per send went from ~2 to 20–30, some answered 429, and delivery reports
   trickled in up to ~10 hours later. Nothing appeared on the Azure status page or in the
   subscription's Service Health. Nothing deployed that day touched the email path; lower had sent
   normally for a full day on the same code.
2. **`EmailService.send` treated "not confirmed yet" as "failed".** It waited with
   `poller.waitForCompletion(2 minutes)`, which *throws* when the wait runs out. The outbox retries
   a send exactly when it throws, so every email ACS had already accepted was POSTed again, up to
   five times (`SendMail` count ≈ 5 × emails in the metrics), and the last attempt recorded FAILED
   and alerted. The recipient saw one copy only because ACS was holding the rest.

The Apple bounce was separate and expected: the account had been deleted, which revokes the Sign in
with Apple link and retires the relay address, and a retry was still queued for it.

## Fix

- `send` waits with `waitUntil(SEND_TIMEOUT, SUCCESSFULLY_COMPLETED)`, which returns the latest
  status instead of throwing. Once `beginSend` has returned (ACS accepted it), `send` never throws:
  - confirmed SUCCEEDED → messageId, as before;
  - confirmed FAILED within the wait → `EmailSendException`, as before (the 2026-08-01 guarantee);
  - still running, or the status polls themselves failed → return the messageId (null if none) and
    record `EMAIL_SEND_UNCONFIRMED`. Not resent.
- `RegistrationDispatchWatchdog` records the alertable `EMAIL_DELIVERY_REPORT_MISSING` when an
  unconfirmed send has no delivery report for its messageId after 24 hours. Without it, an ACS
  failure reported only by the operation status (or a broken Event Grid subscription) would be
  silent. That second case was silent before this change too.

## Takeaway

**Once a provider has accepted a side effect, a retry is a duplicate, not a recovery.** Waiting for
confirmation is fine, but running out of patience must hand the outcome to the out-of-band report
(Event Grid here) plus a watchdog for a report that never comes. It must never throw back into a
retry loop. Pinned by `EmailServiceSendOutcomeTest` (verified red with the old throw restored) and
`MissingDeliveryReportWatchdogTest`. The invariant is in `.claude/rules/registration-and-email.md`,
"Two levels of email truth".
