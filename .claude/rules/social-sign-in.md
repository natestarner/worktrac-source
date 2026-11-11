---
paths:
  - "backend/src/main/java/com/worktrac/backend/identity/**"
  - "backend/src/main/java/com/worktrac/backend/user/AuthService.java"
  - "backend/src/main/java/com/worktrac/backend/user/PasswordChangeService.java"
  - "backend/src/main/java/com/worktrac/backend/user/RegistrationService.java"
  - "backend/src/main/java/com/worktrac/backend/user/User.java"
  - "backend/src/main/java/com/worktrac/backend/account/AccountDeletionService.java"
  - "backend/src/test/java/com/worktrac/backend/identity/**"
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

## Deleting a user deletes its identities

`user_identities.user_id` is `ON DELETE CASCADE` (V103), unlike most FKs here, so every user-removal
path (account deletion's member reap, test-data cleanup's bulk delete) works without knowing this
table exists. Both paths are pinned in `SocialSignInTest`.
