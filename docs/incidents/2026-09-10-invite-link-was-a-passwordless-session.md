# An invite link was a password-less session for anyone who already had an account

**Date:** 2026-09-10 · **Area:** Auth / member logins / security
**Found by:** a product question — *"if they already have a login, why does the invite take them to
a set-password screen?"* The UX complaint was the visible end of a security defect.

## The symptom people could see

`/join` showed everybody the same screen: **"Set up your login — choose a password"**, with the
instruction *"If you already have a Huddle account with this address, leave it blank and we'll use
the password you already have."*

That asks somebody to understand an implementation detail about themselves. It also said the
opposite of the invitation email, which for a known address read *"Open the link below and sign in
with the password you already use for Huddle."* The email described the right design; the screen
did not implement it.

## The defect underneath it

`MembershipInviteService.accept` resolved the invited address to a user and, if one existed,
**used it as-is**:

```java
User user = userRepository.findByEmail(invite.getEmail())
        .orElseGet(() -> { /* create, requiring a password */ });
```

The `password` field was accepted, never compared, and never written. `AuthController` then called
`authService.startSession(...)` and returned a **full 30-day session token**.

So for any address that already had a Huddle account, the emailed link *alone* was a complete
credential. And because `POST /api/auth/session` takes a session token and mints one for any
household the user belongs to, its holder could switch straight into **every other household that
person belonged to, including their own**.

The escalation is what matters: a household owner types an address, and Huddle mails a
reset-strength magic link to it — valid 7 days, re-sendable 5 times. It needs the invitee's inbox,
so an owner cannot do it alone, but "invite someone" is not supposed to be a lever that mints that.

Three smaller defects sat in the same code path:

1. **A signed-in visitor was unhandled.** `/join` is outside `ProtectedRoute` and `JoinPage` never
   read auth state, while `api/logins.js` used plain `apiClient.post` — which attaches the current
   session token. On success `establishSession` **swapped the signed-in identity wholesale**, so
   opening Sam's link on Nate's iPad signed Nate out and Sam in, silently.
2. **On failure it was worse.** Every invite refusal was a 401, and `api/client.js` reads any 401
   on a token-bearing request as "your session expired" — clearing the token and force-navigating
   to `/login`. A signed-in person opening a **stale or already-used** link was thrown out of their
   own working session and never saw the error. Exactly
   [the change-password incident](2026-09-09-change-password-wrong-current-signs-out.md), one
   endpoint over, found the very next day.
3. **The 5-attempt token ceiling had never fired.** `accept` was `@Transactional` with no
   `noRollbackFor`, so the `attemptCount` increment on a bad token rolled back with the exception
   that reported it. Measured: five wrong tokens left the counter at **0**. `RegistrationService`
   and `PasswordResetService` both carry the annotation with a comment explaining precisely this;
   the invite path was the one of the three that did not. Harmless against a 32-byte random token,
   but it was the ceiling a password check was about to be hung beside.

## Why it survived review

The invariant everyone was protecting was real and is still in force: **the two invite paths must
be indistinguishable to the OWNER**, or anyone with a household could type an address and learn
whether that person uses Huddle. `MembershipInviteTest#anExistingAccountIsIndistinguishableFromANewOne`
guards it and still passes.

That invariant is about what the **owner** can observe. It got over-applied to the **invitee**,
who holds the token, reads it out of their own inbox, and already knew the answer — which is how
"the client cannot know which case it is in" became a comment in `JoinPage`, and why nobody
noticed that not knowing had also meant not asking for a credential.

`anAddressThatRegisteredMeanwhileKeepsItsOwnPassword` was the closest thing to coverage. It
asserted the right thing — an invitation must never *change* somebody's password — and passing it
made the surrounding branch look considered. Nothing asserted that an invitation must not *use*
one it never checked.

And the e2e could not have caught #1 or #2 by construction: every invite spec calls
`logout(page)` before opening the link. Signed in is the entire condition.

## The fix

- **An existing address proves itself before anything attaches**, by password (through
  `AuthService.verifyCredentials`, so it carries `/login`'s rate limits and ten-strike lockout) or
  by an existing session belonging to that same address (read via `CurrentUser.optional()`, so the
  filter's `tv`-against-the-database check is not skipped). A brand-new address is unchanged.
- **`POST /api/auth/invite/preview`** answers `SIGN_IN` vs `SET_PASSWORD` so `/join` asks the right
  question. Token-gated and running the same validation gauntlet, so it is not an oracle and not a
  free guess.
- **Both routes refuse with 403, never 401**, so a dead link cannot end a bystander's session.
- **A signed-in visitor is named**, and an invitation for somebody else offers both doors instead
  of swapping identity.
- **`noRollbackFor` on `requireValidInvite`**, so the ceiling actually fires.
- **`accept` and `login` share `sessionOrPicker`**, so joining returns the same two `AuthResponse`
  shapes a sign-in does — and somebody who now belongs to two households lands on the **existing**
  household picker rather than a new journey.

## The second hole, found while reading the first

Checking whether the invite path could safely read identity off the Authorization header turned up
that `POST /api/auth/session` already did — and skipped a check because of it.

`JwtService.parseToken` validates a token's **signature and expiry**. It does **not** compare the
`tv` claim to `users.token_version`; `JwtAuthenticationFilter` does that separately, via
`AccountAccessService.resolve`. `/api/auth/session` is `permitAll` and parses the header itself —
it must, because a selection token deliberately cannot authenticate through that filter — so it
never got the second half. Proven live against local before the fix:

```
GET  /api/auth/me      with a password-change-revoked token -> 401   (correctly refused)
POST /api/auth/session with that same token                 -> 200, and the token it minted works
```

So a password change did not revoke anything, for anyone who called `/session` once. That is the
whole purpose of `token_version`, defeated by the one route that bypasses the filter enforcing it.
Membership revocation was unaffected — `startSession` has always checked the membership.

Fixed by carrying `tokenVersion` out of **both** principal kinds and comparing it in
`startSession`, before the membership lookup so a revoked token cannot be distinguished from a
wrong account id. `PasswordChangeService` passes the version it just minted, through the ordinary
parameter rather than a bypass overload.

**This is why the invite path reads `CurrentUser.optional()` instead of the header.** The
SecurityContext only holds a principal the filter fully validated, `tv` included. Copying
`/session`'s hand-parsing into a new route would have reproduced this hole in the same commit that
fixed the other one.

## The root cause, and the third fix

Both of the above were patches to instances. Asked whether *anything* should be reading credentials
by hand, the honest answer turned out to be that hand-parsing was the symptom:

> **"Valid" had two definitions and only one of them was reachable by name.**

| | signature + expiry | `scp` refused | `accountId` present | `tv` vs the DB | live membership |
|---|---|---|---|---|---|
| `JwtService.parseToken` | ✅ | ✅ | ✅ | ❌ | ❌ |
| going through the filter | ✅ | ✅ | ✅ | ✅ | ✅ |

The stronger half existed **only as inline code inside `JwtAuthenticationFilter`**. A route that
cannot use the filter reaches for the only public thing available, gets the weak half, and nothing
at the call site says so — `parseToken` reads as complete. `/session` wasn't careless; it was the
first route to be in that position, and any future one would have made the identical mistake.

So: **`TokenAuthenticator`** is now the single public answer to "is this valid right now, and whose
is it?", called by the filter *and* by `/session`. `JwtService` keeps one job — minting and
cryptographically reading tokens, no database — and its two parse methods are **package-private**.
`TokenAuthenticator` sits in that package; `AuthController` does not, and can no longer compile a
call to the weak half. Verified by writing the violation and watching javac refuse it.

That third fix also closed a **second inconsistency nobody had noticed**: `/session` only ever
checked the household being asked *for*, never the one the token was scoped *to*, so a token for a
household its holder had been removed from still bought a session elsewhere. Now refused, like
everywhere else in the app.

**A guard test was considered and rejected** in favour of the visibility change. A test that
asserts "only `TokenAuthenticator` calls `parseToken`" reports the mistake after someone makes it;
package-private stops them making it. Prefer the compiler to a checklist wherever the boundary
happens to line up with a package — here it did, for free.

## Takeaways

1. **"Proves the link" and "proves the person" are different questions, and a bearer token in an
   inbox only ever answers the first.** Any flow that turns an emailed link into a session for an
   account that *already existed* is minting a credential for an identity it never authenticated.
2. **A non-enumeration invariant constrains what the UNTRUSTED party can learn. Check who that is
   before extending it.** Applied to the wrong party it stops you asking the invitee a question
   they already know the answer to — and here it stopped us asking for a password.
3. **A UX complaint about a security-adjacent screen is worth reading as a security report.** The
   "leave it blank" instruction was the defect, written down in the product's own copy.
4. **When a counter-and-throw pattern exists three times, check all three.** Two had
   `noRollbackFor` with a comment explaining why; the third silently did not, and no test noticed
   because none asserted the counter.
5. **A route that opts out of the filter chain opts out of every check the filter was doing** —
   and those checks are invisible at the call site, so nothing looks missing. `/api/auth/session`
   had a thorough comment explaining why it parses the header itself and said nothing about what
   that skipped, because the author was thinking about the *selection token* and not about `tv`.
   **The durable fix is not a checklist but a single named validator plus a visibility boundary**:
   if the incomplete check cannot be called, it cannot be called by accident.
6. **When a security property is enforced by "everyone remembers to call X", find out whether the
   language can enforce it instead.** Package-private cost one keyword and is stronger than any
   test, because it fails at compile time rather than at review time — and it lined up here only
   because the boundary happened to match a package. Look for that alignment before writing a
   guard test.
7. **Prove the negative first.** Both `tv` tests assert the stale token is genuinely dead on `/me`
   before asserting `/session` refuses it. Without that line they would pass against a token that
   was simply expired, and guard nothing.
