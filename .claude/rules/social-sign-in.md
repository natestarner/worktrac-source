---
paths:
  - "backend/src/main/java/com/worktrac/backend/identity/**"
  - "backend/src/main/java/com/worktrac/backend/user/AuthService.java"
  - "backend/src/main/java/com/worktrac/backend/user/PasswordChangeService.java"
  - "backend/src/main/java/com/worktrac/backend/user/RegistrationService.java"
  - "backend/src/main/java/com/worktrac/backend/user/User.java"
  - "backend/src/main/java/com/worktrac/backend/account/AccountDeletionService.java"
  - "backend/src/test/java/com/worktrac/backend/identity/**"
  - "frontend/src/components/auth/SocialSignIn.jsx"
  - "frontend/src/components/auth/SigningInOverlay.jsx"
  - "frontend/src/components/auth/useSigningIn.js"
  - "frontend/src/routes/ConfirmEmailPage.jsx"
  - "frontend/src/components/auth/ProviderButtons.jsx"
  - "frontend/src/lib/native/socialSignIn.js"
  - "frontend/src/lib/lastSignInMethod.js"
  - "frontend/src/routes/LoginPage.jsx"
  - "frontend/src/routes/RegisterPage.jsx"
  - "frontend/src/routes/JoinPage.jsx"
---

# Sign in with Apple / Google: the invariants

Design, phases and what is still to build: `docs/architecture/social-sign-in.md`. Every bullet
below is pinned by a test that was verified red by breaking the code it guards.

## ⚠️ An identity is matched by `(provider, subject)`, never by email

`UserIdentityRepository.findByProviderAndSubject` is the only way a provider sign-in finds a user.
An UNLINKED identity whose email belongs to an existing login is **refused** ("sign in with your
password, then connect it in Profile"), and nothing is linked. Linking on a matching email is
account takeover: a Google account can carry a non-Gmail address that has since changed hands.
There is deliberately no `findByEmailAtLink`. Pin:
`SocialSignInTest#anUnlinkedIdentityWithAnExistingLoginsEmailIsRefusedAndNotLinked`, which asserts
no identity row and no token, not just the status.

## The token checks are the library's; ours are named validators

`IdTokenVerifier` uses Spring Security's `NimbusJwtDecoder` (JWKS fetch, cache, re-fetch on an
unknown key id, RS256 only, `alg: none` refused). Never hand-write signature or JWKS code here.

- **`setAllowEmptyExpiryClaim(false)` is load-bearing.** Spring's default accepts a token with no
  `exp`; `IdTokenVerifierTest#aTokenWithNoExpiry` was red without it.
- **The audience list is THIS environment's client ids.** That is what makes a lower token worthless
  against production. Blank ids from an empty env var are dropped (`setClientIds`), so `""` can never
  be a matching audience.
- **The nonce is SHA-256(raw) in lower-case hex**; the client sends the provider the hash and sends
  us the raw value. A token carrying the raw value is refused. `sha256Hex("abc")` is pinned as a
  fixed vector so client and server cannot drift on encoding.
- **`iat` must be within `maxTokenAge` (10 min)** even when `exp` is later (Google's live an hour).
- **Time comes from the injected `Clock`** (`JwtTimestampValidator.setClock`). The unit tests run at
  a fixed 2030 clock, which is what proves the machine's clock decides nothing.
- **"Can't fetch the keys" is `ProviderUnreachableException` → 503**, never a bad-token 401. A
  provider outage must read as "try again", not "your sign-in was bad".

## Status codes

- `POST /api/auth/oauth/{provider}` (permitAll, no session): a bad token is **401**, like `/login`.
  The message names no check; the reason goes to our log only.
- `/api/user/sign-in-methods/**` (session): a bad provider token is **403**, never 401, because a
  401 signs the person out (`backend-core.md`). Pin:
  `SocialSignInTest#aBadProviderTokenIs403AndTheSessionSurvives`.
- A provider that is unknown, unconfigured or switched off answers the **same 404**.
- `SIGN_UP_REQUIRED` (409 with `code`) is the one machine-read code: the client asks for a name and
  resubmits the same token.

## A login with no password (`users.password_hash` NULL, V104)

- **`AuthService.verifyCredentials` treats NULL exactly like a wrong password**: same refusal, same
  failed-attempt count, and a BCrypt comparison against `DUMMY_HASH`. BCrypt returns false for a
  null hash *without hashing*, so skipping the comparison answers ~100ms faster, which would tell
  anyone with the sign-in form which addresses use Apple or Google. Pin:
  `SocialSignInTest#aPasswordSignInFailsExactlyLikeAWrongPasswordIncludingTheBcryptWork`.
- **Never call `passwordEncoder.matches(x, user.getPasswordHash())` without `user.hasPassword()`
  first.** Change-password and account deletion answer 403 `NO_PASSWORD` for such a login, and count
  no failed attempt (nothing was guessed).
- **The last way in cannot be removed**: disconnecting the only identity of a password-less login
  is a 409.

## Who may use it

- **Admin logins never sign in, sign up or connect with a provider** (`refuseAdmin`), and
  `methods()` offers an admin nothing to connect. An ADMIN_EMAILS address minted from a provider's
  say-so would be an admin account nobody chose.
- **Every route acts on `currentUser.userId()` only.** No user id in any path or body: an owner
  attaching their own Google account to a member's login could sign in as that member.
  `MANAGE_OWN_SIGN_IN_METHODS` is held by every role for the same reason `CHANGE_OWN_PASSWORD` is.

## Connecting and disconnecting email the login

`SocialSignInService.connect` / `disconnect` and `AppleNotificationService`'s consent-revoked /
account-delete publish a `user.SecurityNoticeEvent`, on the success path only (never the idempotent
"already connected" return, never a refusal). The rules for those emails, including why a
connection's remedy is "disconnect it" rather than "reset your password", are in
`registration-and-email.md`, "Security notices".

## Disconnecting bumps `token_version`

The usual reason to disconnect is suspecting compromise, so every session ends and the response is a
replacement session (the `PasswordChangeService` shape). The client must swap it in.

## The test provider

`TestIdentityTokens` is `@Profile({"local","lower"})` **and** needs the e2e test-support key, the
same two gates as `TestSupportController`. Its key is DERIVED from the test-support key (so a token
cannot be used to call other test-support routes) and is deterministic (so lower's replicas agree).
`IdTokenVerifierTest#theTestProviderBeanIsConfinedToLocalAndLower` fails if the profile list grows.

## Re-confirmation (phase 3): deleting the account, setting a first password

- **`ReconfirmationService.require` is the only "prove it's you" for a login with no password**, and
  the identity must be linked to THIS login. Somebody else's valid sign-in (the other parent on the
  family iPad) proves nothing. Pins: `ReconfirmationServiceTest#aValidSignInLinkedToSomebodyElseIsNotProof`,
  `ReconfirmationFlowTest#somebodyElsesSignIn*`.
- **It uses `verifyForReconfirmation`, which needs the provider CONFIGURED, not ENABLED.** Switching
  sign-ins off must never strand a password-less login with no way to delete itself.
- **A provider can never overwrite an existing password**: `/api/user/password/initial` is 409 for a
  login that has one. Otherwise a compromised Google account would be a password reset for it.
- **Account deletion checks a re-confirmation FIRST when one is sent**, before the password. A login
  with a password AND Apple connected must re-confirm with Apple (for the revocation code), and that
  must not be skipped because a password was also filled in.
- **Apple revocation runs BEFORE anything is deleted, and its failure is a 503 that deletes
  nothing.** We keep no Apple token, so there is no second chance to revoke afterwards. The code
  exchange must return the SAME Apple subject that is linked here
  (`AppleTokenRevokerTest#aCodeForADifferentAppleAccountIsRefusedAndNothingIsRevoked`). Where
  revocation isn't configured it is skipped with a WARN; production must configure it before
  Apple sign-in is turned on.
- **Deletion removes a login's identities by an explicit bulk delete before the user row**
  (`UserIdentityRepository.deleteAllForUser`, `clearAutomatically`). The DB cascade alone is not
  enough once a re-confirmation has loaded an identity in the same transaction: Hibernate refuses
  the flush, and the irreversible action answers 503.
  `ReconfirmationFlowTest#aLoginWithNoPasswordDeletesByReconfirming` was red without it.

## Apple's server-to-server notifications

`POST /api/webhooks/apple-sign-in`, permitAll, authenticated by the Apple-signed JWT itself
(`IdTokenVerifier.verifyAppleNotification`: Apple's keys, issuer, our audience, `iat` within 3
days, no nonce). `consent-revoked` / `account-delete` disconnect the Apple identity and bump
`token_version`, and **never touch the household** (Apple speaks for one person's Apple ID; the
household may hold other people's training). `email-disabled` / `email-enabled` are audit rows only.
Idempotent; an unknown subject is ignored.

## ⚠️ The "Signing you in" overlay must never trap anyone (`SigningInOverlay.jsx` + `useSigningIn.js`)

A full-screen, opaque overlay covers the gap between handing over a credential and the app
appearing. **Three screens use the ONE component and the ONE hook**: Apple / Google
(`SocialSignIn`, "Signing you in…" / "Creating your household…"), the password form (`LoginPage`,
"Signing you in…") and Confirm on a password registration (`ConfirmEmailPage`, "Creating your
household…", or "account" for a Pro arrival). Never a second overlay or a hand-rolled attempt
counter: the exits below live in the hook, and a copy is where one gets dropped. Deliberately NOT
on the household picker's step (the overlay has already come down before the picker, for both
kinds of sign-in) or on accepting an invitation.

A screen that covers everything is the shape that bricks the app if it can fail to close, so it
has three independent exits and each one must stay:

- **It is `busy` and nothing else.** No second flag. The attempt's `end()` in a `finally` clears it
  on every outcome, and the page navigating away on success unmounts it.
- **It stays up at least `SIGNING_IN_MIN_MS` (500ms)** so a fast answer reads as a step, not a
  flash. The minimum is awaited (`settled()`) only while the attempt is current, before acting on
  any outcome; **never** on "Start over", which must not wait on anything. The three screens' unit
  tests pin it (each verified red with the minimum at 0).
- **"Start over" after `SIGNING_IN_ESCAPE_MS` (60s), which depends on nothing finishing.** The
  requests are time-limited, but the response body, `/me` after it and `restoreOutbox`'s IndexedDB
  read are not, so the `finally` alone is not trusted. 60s = the 45s sign-in limit + `/me`'s 15s;
  earlier would abandon a cold start that was about to succeed.
- **A superseded attempt touches nothing** (`isCurrent()`). After "Start over", a late answer may
  only do one thing: a late SUCCESS still goes into the app (the session is live, so staying on the
  sign-in screen would be the lie; on Confirm the account now exists too). A late failure, picker or
  name step is dropped, and a late `finally` must not clear a NEW attempt's overlay.
- **`onToken` must not return the attempt to `ProviderButtons`.** Its button stays disabled until
  `onToken` settles, so a hung attempt would leave it disabled after "Start over". `ProviderButtons`
  itself is unchanged because Delete account relies on exactly that to block a second tap.
- **Portalled to `<body>`**, so no ancestor transform or overflow can shrink it.

Pinned by `SocialSignIn.test.jsx`, `LoginPage.signingIn.test.jsx` and `ConfirmEmailPage.test.jsx`
("an attempt that never finishes", the minimum), `social-sign-in.spec.ts` (a server that never
answers; a sign-in stuck past every limit) and `password-signing-in.spec.ts` (the password form and
Confirm through the real screens), each verified red by removing what it guards.

## The provider buttons are one matched set (`ProviderButtons.jsx`)

White, outlined pills for every provider, in Google's outline colour (`#dadce0`), the way Reddit,
Spotify, Notion, Hevy and Trello draw theirs (compared 2026-11-24). Apple's is its "white with
outline" style; it was solid black beside Google's white button, which read as two unrelated
controls.

- **On the web Apple takes the exact box of Google's own button** (44px pill, at most 400px wide,
  `matchGoogle`), because Google's iframe cannot be resized and Apple's rule is "no smaller than
  the other sign-in buttons". `renderGoogleButton` asks Google for `shape: 'pill'` to match.
- **In the app both buttons are ours and stay `btn-lg`**, the size of "Log in", which is what App
  Review checks (`SocialSignIn.test.jsx` pins the classes).
- **With no Google button on the web, Apple keeps the full size.** Pinned in
  `ProviderButtons.matchedPair.test.jsx`.

## The sign-in screens: agreement, failures, the last-used caption

- **⚠️ The Terms line sits under the name step's Create button** (`SocialSignIn`'s `SignUpDetails`).
  That step is where an Apple / Google account is created, and it is reachable from **Log in**,
  which shows no Terms of its own. Register hides its own line while the step is up, so exactly one
  agreement is on screen. `social-sign-in.spec.ts` pins both; its Register test waits on the step's
  "Welcome to Huddle" heading, NOT "Your name" (Register's own form has that field, which made the
  first cut pass vacuously).
- **A provider failure is `signInFailure(provider, code)`** (`lib/native/socialSignIn.js`): plain
  words in `message`, the provider's own code in `code`, `signInFailure: true`. Screens show the
  message, and `SocialSignIn` shows the code small underneath for support. Never put a raw code in
  the headline again ("Couldn't sign you in: Sign-in failed (popup_blocked_by_browser)"). Anything
  without the flag is not ours to word: `SocialSignIn` says one plain sentence, the Profile screens
  keep their own. A cancel is still `cancelled: true` and says nothing.
- **"Last used" is per device and names a method only** (`lib/lastSignInMethod.js`, localStorage,
  every access wrapped). Written when the server ACCEPTS a provider (signed in, or a household to
  pick), when a password sign-in or confirmation succeeds, and when an invitation is accepted WITH
  a password (`JoinPage`; joining on an existing session signed nobody in, so it records nothing);
  never on a failure or an unfinished name step. It survives logout on purpose: that is when it is read. It is the guard against a
  second, empty household from an Apple "Hide My Email" address meeting the other provider.
  - **It is `aria-describedby`, never part of the button's name.** "Continue with Apple" stays
    exactly that for screen readers, voice control and every selector in both test layers.
  - **It is a caption UNDER the button ("You last signed in with Apple"), never a badge on it.**
    It was a pill on the button's top edge until 2026-11-23. Apple's guidelines constrain what may
    be drawn on Sign in with Apple, and on the web Google's button is Google's own iframe, which
    anything of ours could only cover.
  - **The device also remembers EVERY method it has used** (`usedSignInMethods`, its own key). A
    family iPad has several people's ways in, and a last-used alone points each at the other's.
    `rememberSignInMethod` reads the list BEFORE moving the last-used key, because on a device that
    predates the list the old last-used value is its only record (`lastSignInMethod.test.js`).
  - **Two screens read that list.** Forgot password names the providers this device used when it
    has NEVER used a password (an Apple "Hide My Email" relay address matches nothing typed there,
    so only the device can point back), and only providers this build still offers. The name
    step opens with "Already have a household?", naming the device's OTHER ways in, or "a different
    way" when it knows none: that step is where the duplicate household is about to be made, and
    nothing exists until its Create button. **On Sign up the general version is left out**
    (`askWhenNothingKnown={false}`): the person chose to make one, and the question would only
    plant doubt. The named version shows there too.
  - **The Reset password (code) screen says "No code? If you signed up with Apple or Google…" to
    everyone**, whatever email was typed, naming only the providers this build offers. It reads
    nothing from the device, so it is the one hint that reaches a NEW device, and because it is
    unconditional it says nothing about whether the typed email has an account. Never make it
    depend on the email: that would turn the reset form into a way to learn which addresses use
    Apple or Google (the same leak `verifyCredentials`' dummy BCrypt exists to prevent).
  - **Kept "You last signed in with …", not "Last used on this device"** (decided 2026-11-23). On a
    family iPad "You" can be a sibling's sign-in, but most devices have one owner and the warmer
    wording reads better there.
  - **No "trust this device" question, deliberately.** It stores method names only, never an email
    or account, so it tells whoever holds the device nothing about who signed in. Storing anything
    that identifies a person ("Continue as Nate", a pre-filled email) would change that answer.
  - **Not a warning on the TAP of the other provider, deliberately** (considered 2026-11-23). On the
    web Google's button is Google's iframe, so its tap cannot be intercepted; it would warn people
    whose other provider is already linked; and it cannot fire on a new device. The name step's
    line covers the same mistake with none of those gaps.

## Deleting a user deletes its identities

`user_identities.user_id` is `ON DELETE CASCADE` (V103), unlike most FKs here, so every user-removal
path (account deletion's member reap, test-data cleanup's bulk delete) works without knowing this
table exists. Both paths are pinned in `SocialSignInTest`.
