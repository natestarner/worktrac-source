# Sign in with Apple + Google: design plan

**Status, 2026-11-11: backend, web frontend, Help page and the iOS plugin are built** on branch
`feat/social-sign-in`, uncommitted, and switched OFF everywhere by default: the backend needs
`SOCIAL_SIGN_IN_ENABLED`, and a screen shows a provider only when that environment's
`config.json` names it. Built: everything in phases 1-3; the Login / Register buttons and the
new-person name step; Profile's "Sign in with" (connect, disconnect), "Set a password", and delete
via the provider; the Help copy (shown only where offered); the CSP; the iOS plugin and adapter;
the e2e spec on the test provider. **Waiting on the console setup** (`docs/social-sign-in-setup.md`):
the deploy-repo settings, the iOS entitlement and URL scheme, a real-device pass, and the launch
items. Invariants: `.claude/rules/social-sign-in.md`.

**Decisions:** the four recommendations below were taken as defaults when the build started
(2026-11-10), without a separate answer from Nate on each: explicit linking only; v1 invites stay
password-only; admin logins can't use providers; available on every plan. Any of them can still
change.

## Goal

Let a person create a Huddle login, and sign in, with Apple or Google instead of a password, on
the web app and the iOS app (Android when it ships). Email + password stays.

**Not in scope:** Facebook, Microsoft, X, passkeys (a good later project of its own), and signing
in to the admin portal with a provider.

## Where the code is today (verified in the code)

- `users` holds one credential per person (`email`, `password_hash NOT NULL`, `token_version`,
  lockout columns). Households hang off `account_memberships`. Member logins (phases 1–9) are
  merged.
- `POST /api/auth/login` checks the password and returns `sessionOrPicker(user)`: either a 30-day
  session JWT, or a 5-minute selection token plus the household picker, finished by
  `POST /api/auth/session`.
- Registration is `register`, then an emailed code at `confirm-email`, then
  `RegistrationService.createAccountUserPerson(email, passwordHash, personName, accountName)`.
- **These three features assume a password exists:** account deletion
  (`DeleteAccountRequest.password`, required), change password, and the lockout counter.
- The admin role is reconciled from `users.email` against `ADMIN_EMAILS` at every login.
- The native app keeps its auth token in `localStorage`, and the auth snapshot is what lets the app
  open offline. Capacitor 8, and there's no sign-in plugin yet.

## The central decision: our session never depends on Apple or Google

Apple or Google is asked **who is this?** at three moments only: sign-in, linking a provider, and
a step-up check (for example, deleting the account). The answer becomes the **same 30-day Huddle
JWT** that a password login produces, and from then on the provider has no part in it. We never
refresh a provider token on app open, never re-check it while the app runs, and never sign
someone out because Google can't be reached.

That one choice keeps all of the degraded-conditions behaviour as it is today: offline open, the
pinned-offline mode, cold starts and the outbox are untouched. Signing in has always needed the
network, and a provider sign-in fails the same way a password sign-in does, with a retryable
message and nothing lost. No new connectivity branch is needed, and nothing goes on the register
in `.claude/rules/resilience.md`.

## Data model

Two migrations, one change each:

- **V103 `add_user_identities`**: `user_identities(id IDENTITY, user_id FK users, provider
  NVARCHAR(20), subject NVARCHAR(255), email_at_link NVARCHAR(255), created_at DATETIME2,
  last_used_at DATETIME2)`, with a **unique index on `(provider, subject)`** and an index on
  `user_id`.
- **V104 `make_users_password_hash_nullable`**: a user created by Apple or Google has no password
  until they choose to set one.

**A returning person is matched by `(provider, subject)` only, never by email.** People change
their Google email and Apple relay addresses, but the subject stays the same for life.
`users.email` stays the contact address and the unique login key.

## Sign-in flow

1. The client gets an **ID token** from the provider: the native sign-in sheet on iOS (via a
   Capacitor plugin), or Google Identity Services / Sign in with Apple JS on the web. The client
   generates a nonce and sends its hash to the provider.
2. `POST /api/auth/oauth/{apple|google}` with `{ idToken, nonce, appleAuthorizationCode?, name? }`.
3. The backend checks the token's **signature against the provider's JWKS** (cached, refreshed
   when an unknown key id appears), then `iss`, `aud` (one of our client IDs: web, iOS bundle,
   later Android), `exp`, and the nonce.
4. It finds the user (see the next section) and returns **`sessionOrPicker(user)`**, the same two
   response shapes a password login returns. The household picker, `/session`, the admin-role
   reconcile and the frontend's handling of the response are all reused unchanged.

**The verifier uses a standard library, not our own JWT checks.** Nimbus JOSE+JWT (the library
under Spring Security's resource server) does the signature, JWKS caching and key rotation; our
code only adds the claim checks each provider needs. Hand-written signature or claim checks are
where these features usually go wrong.

There are no redirect or callback endpoints and no server-side session state, so it scales the
same way across replicas. The route gets its own per-IP rate-limit bucket alongside the login
ones.

## Finding the user: the security-critical part

| Case | What happens |
|---|---|
| `(provider, subject)` is already linked | Sign in as that user. Update `last_used_at`. |
| Not linked, and **no** user has that email | **Sign up**: a short "your name / household name" step, then `createAccountUserPerson(email, null, …)`. No emailed code, because the provider has already verified the address. Google tokens with `email_verified != true` are refused. |
| Not linked, and a user **already has** that email | **Don't link silently.** Reply "You already have a Huddle login for this email. Sign in with your password, then connect Google in Profile." |

**Why not link automatically when the emails match?** Linking on email trusts the provider's claim
that the person owns the address *today*. That's true for Gmail, but a Google account can carry
a non-Gmail address that has since changed hands, for example an old work domain. Auto-linking
would hand that household to whoever controls the Google account. Explicit linking costs one extra
step for an existing user, who is usually already signed in for 30 days anyway, so it's a small
price. Telling them an account exists is not the user-enumeration hole that password reset guards
against: the caller has just proved they own that email.

This rule also protects admin accounts. A provider sign-in can never take over an `ADMIN_EMAILS`
address, because that email already belongs to a password user and is never auto-linked.

**Linking from Profile:** "Connect Apple / Google" runs the same client flow and calls
`POST /api/auth/identities/{provider}` with a normal session. A `(provider, subject)` that already
belongs to another user is refused. **Unlinking** is refused when it would leave the user with no
way to sign in (no password and no other identity).

## What changes for features that assume a password

- **Change password** becomes **"Set a password"** for a user with none (no current-password field).
- **Forgot password** already works as "set a password", because it proves ownership of the email.
  Leave it as it is.
- **Delete account**: a user with no password proves who they are by **signing in with the provider
  again** in place of typing the password; typing DELETE is still required. For Apple, the fresh
  authorization code is exchanged and the token is **revoked**
  (`appleid.apple.com/auth/revoke`), which App Store Review requires for apps offering Sign in with
  Apple. A step-up at deletion time means **we never store an Apple refresh token**.
- **Password sign-in on an account with no password** must give exactly the same "Invalid email or
  password" (same status, same timing work, same lockout counting) as a wrong password. It must
  never be a 500 from comparing against a null hash, and never a different message, which would
  reveal that the address uses Apple or Google. Every `passwordEncoder.matches` call site gets
  this treatment and a test.
- **Lockout**: does not apply to provider sign-ins. Rate limits do.
- **Revoking sessions** (`token_version`) works as now. Unlinking a provider bumps it.

## Apple's "Hide My Email"

A relay address (`…@privaterelay.appleid.com`) becomes `users.email`. Apple **drops mail from
senders it doesn't know about**, so before Apple sign-in goes live Nate must register the ACS
sender domain and address in the Apple Developer portal (Sign in with Apple for Email
Communication), and SPF and DKIM must pass. If this is skipped, invites, resets and receipts
silently never arrive. The existing outbox audit would record them as SENT, because ACS accepted
them.

Apple sends the person's name **only on the first sign-in**. The client passes it along to prefill
the sign-up step.

## Clients

- **Web:** Google Identity Services (the button, using the ID-token response) and Apple JS in popup
  mode. Apple refuses `localhost` as a return URL, so local Apple testing on the web uses the test
  provider described below.
  - **Apple's popup has to open inside the tap.** iPhone Safari blocks a popup opened after an
    `await`, and the first version loaded Apple's script and hashed the nonce between the click and
    `AppleID.auth.signIn()`. On lower (2026-11-11) iPhone Safari answered "Sign-in failed" while
    desktop Chrome, which allows ~5s of grace after a tap, worked. So the button arms Apple when it
    mounts (`prepareSignIn`: script, a fresh nonce, `init`), the click calls `signIn()` with nothing
    awaited first, and every attempt re-arms with a new nonce. Pinned by
    `socialSignIn.appleTap.test.js`. A failure other than a closed popup carries Apple's error code
    into the message, so a report from a phone says what Apple refused.
  - **Google's button is an iframe with a light-only document.** On a dark page the browser paints an
    opaque backdrop behind an iframe whose colour scheme differs, which drew a white box around the
    button in iPhone Safari's dark mode. Its host sets `color-scheme: light`
    (`ProviderButtons.googleScheme.test.jsx`).
- **iOS:** one maintained Capacitor plugin covering both providers (look at
  `@capgo/capacitor-social-login` first; pin an exact version), imported lazily inside the native
  branch as the other plugins are. This needs the **Sign in with Apple entitlement** (the
  provisioning profiles must be regenerated through `match`), the Google iOS client ID, and its URL
  scheme in `Info.plist`.
- **Buttons:** the Apple button follows Apple's design rules (black or white, the official
  wording, at least as prominent as Google). Shown on Login, Register, and Profile → Sign-in
  methods.
- A **feature flag** (`SOCIAL_SIGN_IN_ENABLED`, off by default) hides the buttons and makes the
  route 404, so the backend can ship ahead of the setup work.

## Testing

- **Backend unit tests:** the token verifier against locally generated RSA keys and a stub JWKS
  (no network). Cover: a bad signature, the wrong `aud`, the wrong `iss`, expired, nonce mismatch,
  `email_verified=false`, and an unknown key id that triggers one JWKS refresh.
- **Integration tests:** every row of the table above; refusing an identity that belongs to
  someone else; refusing to unlink the last sign-in method; deletion step-up including the Apple
  revoke call (stubbed); a token-version bump on unlink; and that the selection-token path is
  identical to a password login's.
- **e2e:** real Apple and Google can't be automated (bot checks). Add a **test provider**, an
  issuer whose JWKS the backend trusts **only** behind `E2E_TEST_SUPPORT_KEY` in local and lower,
  so Playwright can mint ID tokens. A unit test asserts the production profile refuses it.
  Specs: sign up, sign in, the existing-email refusal, link and unlink, set a password, delete with
  step-up. Mark the sign-in spec `@critical`.
- **Manually, on a lower TestFlight build:** real Apple (including Hide My Email, and checking that
  an invite email reaches the relay inbox) and real Google, on iPhone and iPad, and on the web.

## Also required (added on a second pass)

The first draft missed these. "Verified" means the code was checked; "check" means it's likely
but hasn't been confirmed yet.

**The web app would block the buttons as it stands (verified).**
`frontend/public/staticwebapp.config.json` sends a CSP of `script-src 'self' https://js.stripe.com`
with no `frame-src` for Google or Apple. The Google button script, Google's iframe, and Apple's JS
popup would all be blocked. Add `https://accounts.google.com` (script, frame, connect) and
`https://appleid.cdn-apple.com` / `https://appleid.apple.com` to the right directives, scoped to
the app routes only (`/embed/*` has its own CSP and stays as it is).

**The login screen must still work when those scripts fail to load.** Offline, under lie-fi, or
when a content blocker strips Google's script, the provider buttons must disappear or show "not
available right now". The page must never go blank or show a spinner, and password sign-in must
be unaffected. The scripts load lazily when the login screen opens, never at boot and never in the
service-worker precache.

**Google refuses sign-in inside an embedded WebView** (`disallowed_useragent`). In the iOS app the
web flow can't be used even as a fallback; the native plugin is the only path, so the native branch
must never fall through to the web button.

**Each environment needs its own client IDs.** Lower (`app.dev.huddle.fitness`, the Huddle Lower
TestFlight bundle) and production (`app.huddle.fitness`, the App Store bundle) need separate Google
OAuth clients and Apple Services IDs, return URLs and bundle IDs. The backend's accepted `aud`
list and the frontend's client IDs therefore come from configuration per environment:
- **Frontend:** the deploy-time `config.json` (the same mechanism as the API URL), not baked into
  the build.
- **Backend:** environment variables on the Container App. That lives in the **`worktrac-deploy`**
  repo (Bicep / workflow secrets), so it's a second-repo PR that wasn't counted. The prod change
  lands on the `production` branch, which Nate merges.

**The Apple key (.p8) and the client secret.** Apple's "client secret" is a JWT that we sign with
the .p8 key and that expires after at most 6 months. Generate it for each request (it's only needed
for the code exchange and the revoke call) instead of storing one that will silently expire. The
.p8 goes in as a Container App secret, never committed. Rotating the key is a documented manual
step.

**Apple server-to-server notifications.** Apple POSTs signed events to an endpoint we register:
`consent-revoked` and `account-delete` (the person stopped using Apple ID with Huddle) and
`email-disabled` / `email-enabled` (relay forwarding turned off or on). Handle at least
`consent-revoked` / `account-delete` by unlinking the identity and bumping `token_version`. If
that leaves the user with no way to sign in, they're signed out and can recover through
forgot-password, provided the relay still forwards; if it doesn't, contact support. Record
`email-disabled` so a failed send is explained in the admin portal rather than looking like an ACS
fault. This is a new permitAll route that verifies Apple's signed JWT; it needs its own tests.

**Every place a user row is removed (check each one).** `AccountDeletionService` (verified to
remove users), `TestDataCleanupService`, and member-login revoke (phase 7b) must remove the user's
`user_identities` rows. The FK makes a forgotten one fail loudly rather than leave orphans, which
is the behaviour we want, but each one needs a test. The admin portal's user view should list the
sign-in methods (provider + linked date, never the subject).

**Terms and age at sign-up (check).** The provider sign-up step must collect whatever the password
form collects and records (name and household name today, per `RegisterRequest`; check whether a
terms or age confirmation is recorded anywhere). Google Family Link child accounts may be refused by
Google, or need a parent's approval, before they reach us. That's another reason for kids to be
added as members by a parent rather than signing up themselves.

**Registration audit and watchdog (check).** A provider sign-up sends no verification code. Check
that `RegistrationDispatchWatchdog` only looks for registrations that are owed an email, so
provider sign-ups aren't reported as "never dispatched". Provider sign-ups get their own audit
event type.

**Never log a token.** Make sure `AuthRequestLoggingFilter` and the request diagnostics never write
the `idToken` / `appleAuthorizationCode` body fields, and that verifier failures log the reason
(wrong aud, expired, …), never the token.

**App Store paperwork.** Update the App Privacy answers in App Store Connect (we now receive a
user ID from Apple / Google). Add a note for App Review, whose demo login stays a password account.
Apple's button and wording guidelines are checked in review.

**Google consent screen.** Basic scopes (`openid email profile`) don't need Google's full
verification, but the consent screen needs the privacy policy URL, the authorized domains
(`huddle.fitness`), and brand verification for the Huddle name and logo to show. It must be
switched to "In production". While it's in "Testing", only listed test users can sign in.

**Optional, later:** Google's Cross-Account Protection (RISC) events, the Google equivalent of
Apple's notifications, which tell us when a Google account is compromised or disabled.

## Phases (one PR each; each leaves `main` shippable with the flag off)

0. **Setup (Nate, by hand)**: an Apple Services ID, a Sign in with Apple key (.p8), and the
   private-relay sender registration; a Google Cloud OAuth consent screen (brand, privacy policy,
   verified domains), each **for lower and for production**; client IDs for web and iOS; secrets
   added with `gh secret set` (Claude provides the commands).
1. **Backend core**: V103 and V104, the verifier, sign-in for already-linked identities, link and
   unlink endpoints, the test provider, no token logging, every user-removal path cleaning up
   identities, behind the flag.
2. **Sign up with a provider**: account creation, the registration-audit event and watchdog check,
   terms and age parity, and the existing-email refusal.
3. **Password-optional paths**: set password, delete with step-up plus the Apple revoke, the
   unlink rules, the Apple server-to-server notifications endpoint.
3b. **`worktrac-deploy`**: the Container App env vars and secrets for lower (then, separately,
    production on the `production` branch).
4. **Web frontend**: the CSP change, lazily loaded buttons that degrade offline, `config.json`
   client IDs, the sign-up name step, Profile → Sign-in methods, the admin portal's sign-in
   methods view, e2e. Flag on in lower.
5. **iOS**: plugin, entitlement, profiles, a lower TestFlight build, the manual checks.
6. **Copy and launch**: the help page (`user-facing-help.md`), the privacy policy (what Apple and
   Google share with us), App Store privacy answers, App Review notes, Google consent screen to
   "In production", then promote to production and turn the flag on there.

Android adds a client ID and a Google button later. Its Play Store has no "Apple" requirement.

## The API as built (phases 1-2)

| Route | Who | Answers |
|---|---|---|
| `POST /api/auth/oauth/{apple\|google}` `{idToken, nonce, personName?, accountName?}` | anyone (permitAll) | the `/login` shapes (session or household picker); 409 `SIGN_UP_REQUIRED` for a new person with no name yet; 409 (no code) for an existing login's email; 401 bad token; 403 no verified email / admin; 503 provider unreachable; 404 provider off |
| `GET /api/user/sign-in-methods` | signed in | `{hasPassword, connected[{provider, connectedAt, lastUsedAt}], available[]}` |
| `POST /api/user/sign-in-methods/{provider}` `{idToken, nonce}` | signed in | the list again; 403 bad token (never 401); 409 identity on another login, or a second account from one provider |
| `DELETE /api/user/sign-in-methods/{provider}` | signed in | a REPLACEMENT session (token_version bumped); 409 if it is the only way in |
| `POST /api/auth/test/id-token` | local/lower + e2e key | `{idToken}` from the test provider, for e2e (`/api/auth/oauth/test`) |

**The nonce contract for the clients:** generate a random raw nonce (at least 16 characters), give
the provider `sha256(raw)` as lower-case hex, and send us the raw value with the token.

Config: `SOCIAL_SIGN_IN_ENABLED`, `SOCIAL_SIGN_IN_GOOGLE_CLIENT_IDS`,
`SOCIAL_SIGN_IN_APPLE_CLIENT_IDS` (comma-separated, per environment).

### Added in phase 3

| Route | Who | Answers |
|---|---|---|
| `POST /api/user/password/initial` `{newPassword, reconfirmation}` | signed in, no password yet | a replacement session; 409 if the login already has a password; 403 if the re-confirmation is bad or for another account |
| `DELETE /api/account` `{confirmationText, password?, reconfirmation?}` | owner | 204; `password` is now optional. A login with no password sends `reconfirmation`. **A login with Apple connected must re-confirm WITH APPLE and send `appleAuthorizationCode`** (403 `APPLE_RECONFIRMATION_REQUIRED` otherwise), so Huddle's Apple sign-in can be revoked first; if Apple can't be reached, 503 and nothing is deleted |
| `POST /api/webhooks/apple-sign-in` `{payload}` | Apple | 200; 400 bad payload; 404 where Apple isn't configured |

`reconfirmation` is `{provider, idToken, nonce, appleAuthorizationCode?, appleRedirectUri?}`. The
identity must already be linked to THIS login. Re-confirmation works whenever the provider is
configured, even with new sign-ins switched off, so turning the feature off never strands a login
that has no password.

## The four decisions (recommended defaults, taken 2026-11-10)

1. **Existing email**: explicit linking from Profile (recommended) or auto-link on a verified
   email?
2. **Accepting invites with Apple or Google** (`/join`): wait for v1.1 (recommended; v1 keeps
   invite acceptance on passwords, and the invitee can connect a provider afterwards), or include
   it now? With Hide My Email the provider's address won't match the invited address, so this
   needs its own design.
3. **Admin accounts**: refuse provider sign-in for `ADMIN_EMAILS` users altogether (recommended),
   or allow it once linked?
4. **Who can use it**: everyone, or Pro only like member logins? Recommendation: everyone. It's a
   way to sign in, not a feature to sell.
