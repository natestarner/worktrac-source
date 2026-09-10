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
  the two cannot drift. No password on either path, which is why `AuthService.startSession`'s two
  checks — **the token version, then the membership** — are the entire security of it. A household
  you are not in answers **404, not 403** — a 403 confirms the account id is real, which is an
  enumeration oracle spanning households.
- **⚠️ THIS ROUTE MUST CHECK `token_version` ITSELF, and for a long time it did not.** Every other
  route gets that check free from `JwtAuthenticationFilter` (via `AccountAccessService.resolve`),
  which is what makes a password change actually revoke every token a user holds. This one parses
  the Authorization header by hand — it has to, since a selection token cannot authenticate through
  the filter — and **`JwtService.parseToken` validates the signature and the expiry and nothing
  else**. So the route swapped a token every other route already refused for a fresh 30-day one:
  *changing your password because you believed you were compromised did not sign the attacker out*,
  as long as they called this once. Proven live before the fix (`/me` → 401, `/session` → 200 with
  a working token).
  - **Both branches carry it** — a selection token has a `tv` claim too, and is minted against the
    value current at login, so a password changed from another device while the picker is on screen
    must invalidate it.
  - **401 here is correct and is not the trap `backend-core.md` warns about**: what failed *is* the
    token that made the request, not a second credential alongside it.
  - Checked **before** the membership lookup, so a revoked token cannot be told apart from a wrong
    account id — answering 404 first would confirm the token still works.
  - **Polarity is absent-means-CURRENT**, like `role` and `scp`: a token minted before the claim
    existed parses as 0 and matches a never-bumped row. Inverting it signs out every user at deploy.
  - `PasswordChangeService` passes the version it just **minted**, not the request's — deliberately
    through the ordinary parameter rather than a bypass overload, since one entry point that always
    checks is harder to misuse than two where one skips it.
  - `HouseholdSwitchTest#aTokenRevokedByAPasswordChangeCannotBeSwappedForAFreshOne` and
    `#aSelectionTokenIsRefusedOnceThePasswordChangesUnderIt` are the pins; both assert the stale
    token is genuinely dead on `/me` first, or they would prove nothing.
  - **Membership revocation was never affected** — `startSession` has always checked
    `findByAccount_IdAndUser_Id`. This was specifically the `token_version` axis.

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
- **⚠️ THE EMAILED TOKEN PROVES THE LINK, NEVER THE PERSON.** An address that already has a login
  must prove itself before the membership attaches, and there are exactly two ways: its
  **password**, checked through `AuthService.verifyCredentials` so it carries the same rate limits
  and the same ten-strike lockout as `/login`; or an **existing session belonging to that same
  address**, read via `CurrentUser.optional()`.
  - This was not always so. Accept used to mint a **full 30-day session for a known address with no
    credential check at all** — and since `/api/auth/session` takes a session token, its holder
    could then reach every other household that person belonged to, their own included. Any owner
    could cause a link with that power to be mailed to any address they could type, live 7 days,
    re-sendable 5 times. `MembershipInviteTest#anExistingAddressCannotJoinWithoutItsPassword` is
    the pin, and it asserts **no membership is created**, not just that the response is refused.
  - **Read the session through `CurrentUser.optional()`, never by parsing the header.**
    `JwtService.parseToken` does **not** compare `tv` to the database — `JwtAuthenticationFilter`
    does, separately — so hand-parsing accepts a token a password reset already invalidated.
    `/api/auth/session` must parse by hand (a selection token cannot reach the filter); nothing
    else may borrow that shape.
  - Being signed in as **somebody else** proves nothing about the invitee and is refused. The
    client offers to switch; it must never swap identity silently.
  - A **missing** password is refused before `verifyCredentials`, so it costs the invitee no
    attempt — otherwise replaying the link is a way to lock them out of their own account without
    guessing a character. A **wrong** one still counts.
- **⚠️ `POST /api/auth/invite/preview` is token-gated, and that is what keeps it from being the
  forbidden oracle.** It answers `SIGN_IN` vs `SET_PASSWORD` so `/join` can ask the right question
  instead of offering one password field to everybody with "leave it blank if…". The oracle the
  bullet above forbids is the **owner's**, and an owner never sees this token — the raw value goes
  from `generateToken()` straight onto the event and into the email, and the owner's own response
  is a hardcoded `INVITED` row. The holder could already learn this by POSTing accept with a blank
  password. It runs the same `requireValidInvite` gauntlet, so a bad token burns an attempt here
  too and it cannot be a free guessing oracle.
- **⚠️ Accept and login share `AuthService.sessionOrPicker`**, so accepting returns the SAME two
  `AuthResponse` shapes a sign-in does — one membership signs straight in, two or more return the
  household picker plus a selection token. That is why joining needs no journey of its own: the
  client reads the same `token == null` it already read, and `JoinPage` renders the same
  `components/auth/HouseholdPicker` `LoginPage` does.
- **⚠️ NEITHER invite route may answer 401 — both refuse with 403 (and 423 when locked).** They are
  `permitAll`, but the browser attaches whatever session token it holds, and `api/client.js` reads
  **any** 401 on a token-bearing request as "your session expired": it clears the token and
  force-navigates to `/login`, with no per-route opt-out. So a signed-in person opening a stale or
  already-used link was thrown out of their own working session and never saw the reason. Same
  shape as `docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md`.
  `MembershipInviteTest#noInviteRefusalEverAnswers401` and the e2e
  *"a dead invite link opened while signed in does not end that session"* pin it — the latter is
  the only test that can, since every other invite spec logs out before opening a link.
- **Every way an invitation can fail to authorize returns ONE refusal.** Wrong id, wrong token,
  expired, already accepted, locked out — the same status with the same sentence. Distinguishing
  them tells whoever holds a bad link which part to keep trying. The invariant is about the
  **sentence**, not the number; the number is 403 for the reason above.
- **⚠️ `requireValidInvite` needs `noRollbackFor`, and the attempt ceiling is inert without it.**
  The bad-token branch increments `attemptCount` and then throws; Spring's default
  rollback-on-RuntimeException discarded that increment **every time**, so the counter never left
  zero and `MAX_ATTEMPTS` had never once fired in production. `RegistrationService.confirmEmail`
  and `PasswordResetService.confirmReset` both carry the annotation with the same comment; the
  invite path was the one of the three that did not.
  `MembershipInviteTest#fiveWrongTokensLockTheInvitationOut` fails (counter 0, not 5) without it.
  The ceiling is checked **before** the BCrypt compare, so it also bounds the CPU an anonymous
  caller can spend on these two permitAll routes.
- **Accept must `accountAccessService.invalidate(userId, accountId)`.** It did not, which was
  survivable only while every accepter was signed out. A signed-in joiner whose device touched the
  household in the last 60s would otherwise be refused inside a household they had just joined.
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
- **⚠️ Any email CTA that appends its OWN path must build on `EmailService.appOrigin`, never bare
  `appUrl`.** `APP_EMAIL_APP_URL` is configured in every real environment as a full "open the app"
  link WITH a path already on it (`.../app/log`, confirmed live in lower and production), not a
  bare origin. `joinUrl()` once did `appUrl + "/join?..."` and produced `.../app/log/join?...`, a
  path the SPA has no route for — its catch-all silently sent every invite link to `/login` with
  nothing on screen to explain why. `appUrl` bare is still correct for the CTAs that just want to
  "open the app somewhere reasonable" (`sendRegistrationSuccess`, `sendAddedToHousehold`,
  `sendLoginRevoked`) — only a caller building a specific path of its own needs the origin.
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
