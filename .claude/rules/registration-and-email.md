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

- `ContactEmailEventListener` follows the same shape for Contact Us submissions, but records the
  outcome **on the `contact_messages` row itself** (`alert_status` / `alert_message_id` /
  `alert_detail`) rather than as a separate audit event — the row already exists and is what the
  admin reads, so "was I actually told about this?" is answerable without correlating two tables.
  `alert_status` is inserted as **`PENDING`**, which is what keeps "the listener never ran" visibly
  distinct from "it ran and succeeded". Its status write goes through `ContactAlertStatusService`,
  which is `REQUIRES_NEW` for the same reason `RegistrationAuditService.record` is.
- **`sendAdminAlert` is plain-text only, and that is load-bearing now that a contact body embeds
  text a household member typed** — with no HTML part there is nothing for markup in that text to
  inject into. Do not give it a template. The subject is stripped of CR/LF before it reaches the
  mail API, because a subject line is an email *header*.
- **The Contact Us alert mails `ADMIN_EMAILS`, not the submitter**, so `e2eNoopRecipientPattern`
  must cover the admin address or every e2e run sends real mail. Both `application-local.yml` and
  `application-lower.yml` therefore match `nate+huddleadmin@starner.co` as well as the
  `huddle+e2e-` households. Production sets no pattern at all, so it still mails for real.
  - ⚠️ **That admin literal is a third independently-maintained copy**, alongside
    `worktrac-deploy`'s `config/{lower,production}/backend-env.json` and its two deploy workflows.
    If `ADMIN_EMAILS` ever changes, these patterns must change with it — otherwise e2e silently
    starts sending real mail again. `EmailServiceE2eNoopTest` pins the deployed regex against both
    addresses, and against `huddle+livewiretest-` still falling *outside* it (widening the pattern
    must never swallow `live-email-canary.spec.ts`'s deliberate real send).
  - Widening lower's pattern also silences lower's registration send/delivery **failure** alert
    emails, which share `sendAdminAlert`. Deliberate: the no-op skips only the ACS call, so every
    `RegistrationEvent` row is still written and the Activity tab still shows the failure.

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

## Login has TWO response shapes, and the common one must never move

`POST /api/auth/login` answers with a session (`token` set, plus `account`/`membership`/`person`)
when the credential resolves to exactly one membership — **byte-for-byte what it always did**,
which is every household today. Two or more memberships answer `token: null` plus `households[]`
and a `selectionToken`, and `POST /api/auth/session` mints the real thing from a chosen account id.

- **The client branches on `token == null`, not a status field.** One nullable it already had to
  read beats a second vocabulary both sides must agree on, and it fails safe: a client that ignores
  `households` entirely sees a null token and reports a failed sign-in rather than acting on a
  token it cannot use.
- **Zero memberships stays a 401** with a specific message ("no longer attached to a household"),
  not a 403 with a code. They proved the password, so this reveals nothing — and there is nothing
  for the client to branch on.
- **`POST /api/auth/session` serves BOTH finishing a login and switching household.** One route, so
  the two cannot drift. No password on either path, which is why `AuthService.startSession`'s
  membership lookup is the entire security of it. A household you are not in answers **404, not
  403** — a 403 confirms the account id is real, which is an enumeration oracle spanning
  households.

## Member-login invites — what the OWNER must not be able to learn

`POST /api/account/logins/{personId}/invite` (owner, `MANAGE_LOGINS`) creates a
`membership_invites` row; `POST /api/auth/accept-invite` (permitAll) turns it into a membership.
The table deliberately mirrors `pending_registrations`: BCrypt'd secret, expiry, attempt ceiling,
resend cooldown.

- **⚠️ BOTH invite paths require acceptance, and the two must be INDISTINGUISHABLE to the owner.**
  Whether the invited address already has a Huddle account or not, the owner sees one outcome —
  `INVITED` — and the membership exists only once the invitee acts. Attaching it immediately for a
  known address would be a **user-enumeration oracle**: anyone with a household could type an
  address and learn whether that person uses Huddle, through a route needing no password. It leaks
  exactly what `PasswordResetService`'s non-enumerating design and `DUMMY_HASH` exist to hide.
  The **email body** differs (choose a password vs. sign in with the one you have); nothing the
  owner can observe does. `MembershipInviteTest` pins this by asserting the two responses carry
  identical field sets.
- **A fourth `PersonLoginDto` state meaning "activated instantly" would reintroduce that oracle.**
  Three states exist — `NONE`, `INVITED`, `ACTIVE` — and an expired invite reads as `NONE`, because
  showing it as pending leaves the owner waiting on something that can never be accepted.
- **⚠️ Accept must survive the invited address registering its OWN household first.** By accept
  time the user exists, so blindly creating one collides on the unique email index and fails an
  otherwise-valid invitation. Accept looks the user up, creates only if genuinely absent, and
  **never touches an existing user's password** — an invitation silently changing somebody's
  credentials is the one thing a household owner must not be able to do.
- **Every way an invitation can fail to authorize returns ONE refusal.** Wrong id, wrong token,
  expired, already accepted, locked out — the same 401 with the same sentence. Distinguishing them
  tells whoever holds a bad link which part to keep trying.
- **A resend mints a NEW token**, so a link already in an inbox stops working. The usual reason to
  resend is that the first went astray, and leaving both live doubles the window a mis-sent link is
  usable. It also resets the attempt ceiling, which guards *one* secret.
- **A failed invite email is NOT recoverable by resending.** The raw token exists only on the
  `MembershipInviteIssuedEvent`; the row holds a BCrypt hash that cannot reproduce it. The owner
  must re-issue. That is why the failure is audited (`MEMBER_INVITE_EMAIL_FAILED`) rather than
  logged — from the owner's side, an invitation that never arrived is indistinguishable from one
  the recipient is ignoring.
- **The link carries an id AND a token** (`/join?i=<id>&t=<token>`). A BCrypt hash has a per-row
  salt, so there is no equality to index and the token alone cannot find its row.
- **⚠️ `membership_invites` has NO ACTION FKs to accounts, people AND users**, so both deletion
  paths clear invites **first**, and both null `invited_by_user_id` for users being reaped — a
  member's invitation in *another* household must survive their removal from this one.
- **Names are HTML-escaped into the invite template.** Person, household and owner names are free
  text the household typed; unescaped, a household name is a script injection into every invitee's
  inbox.

### ⚠️ The selection token: a credential that is deliberately not a session

`scp: "select"`, no `accountId`, five minutes. It buys exactly one thing — the right to call
`POST /api/auth/session` — and `JwtService.parseToken` refuses **any** token carrying `scp`.

- **That refusal must stay explicit.** A selection token also carries no `accountId`, so the null
  guard would reject it anyway — which means the security of this design would rest on an
  *absence*, one convenience field away ("let the picker preselect something") from silently
  becoming a full 30-day session. **Deleting the `scp` check and re-running the suite still
  passes**; `JwtServiceTest` mints the future mistake instead (`scp` **and** a valid `accountId`)
  and is the only thing that goes red.
- **Polarity is absent-means-FULL**, exactly like `role` and `tv`: every token minted before the
  claim existed carries none and must keep working. Inverting it signs out every existing user at
  deploy.
- **`SelectionPrincipal` is a separate type from `AccountPrincipal` on purpose** — the compiler then
  enforces what a comment could only ask for.
- **It is never stored.** The client sends it through `api/client.js`'s per-call `bearerOverride`;
  putting it in `localStorage` recreates the stranded-token shape of
  `docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md`, where boot cannot tell a
  credential the server refuses by design from a live session whose server is briefly down.
- `/api/auth/session` is `permitAll` in `SecurityConfig` **because** a selection token cannot
  authenticate through the filter; it reads and validates the header itself.
