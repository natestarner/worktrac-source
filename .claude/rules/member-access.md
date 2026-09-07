---
paths:
  - "backend/src/main/java/com/worktrac/backend/membership/**"
  - "backend/src/main/java/com/worktrac/backend/user/**"
  - "backend/src/main/java/com/worktrac/backend/person/**"
  - "backend/src/main/java/com/worktrac/backend/account/**"
  - "frontend/src/context/AuthContext.jsx"
  - "frontend/src/hooks/useAccountAccess.js"
  - "frontend/src/components/profile/**"
  - "frontend/src/components/shared/ReadOnlyWrap.jsx"
  - "frontend/src/components/shared/PausedLoginScreen.jsx"
  - "e2e/tests/member-*.spec.ts"
---

# Member logins — the three-layer model, and where each rule actually lives

A household used to be one login. It is now three layers, and confusing any two of them is the
source of every bug this feature has produced:

| Layer | Table | What it is |
|---|---|---|
| **Credential** | `users` | An email + password. Belongs to a PERSON IN THE WORLD, not to a household. One email = one password = N households. |
| **Membership** | `account_memberships` | `(account_id, user_id, person_id, account_role)`. What a credential may do **in one household**. This is the authorization boundary. |
| **Profile** | `people` | A name you log workouts against. Exists with or without a login, and **outlives one**. |

`users.account_id` still exists, nullable and unread, pending the contract half of an
expand/contract — see the migration note at the bottom.

## Most of the rules live in other files. Do not duplicate them here.

This file is the map plus the handful of invariants that are genuinely cross-cutting. Everything
else belongs where it already is, next to the code it constrains:

| Question | File |
|---|---|
| Guards, permissions, `AccountAccess`, the 404/403 asymmetry, shared-resource ownership | `backend-core.md` |
| Invites, the enumeration oracle, the selection token, the async email pipeline | `registration-and-email.md` |
| The Pro pause, and why "a plan decides what a screen shows" needed a second sentence | `billing.md` |
| Outbox/app-state keying by `(account, login)`, the hand-over delete guard | `offline-internals.md` |
| `ReadOnlyWrap` precedence, the viewer's default person, persisted-state scoping | `frontend-core.md` |
| What the handbook promises members and owners | `user-facing-help.md` |
| The Tier-3 / durable split and the sanctioned divergences | `resilience.md` |

## The cross-cutting invariants

### ⚠️ A login is removable; a person and their training data are not

Revoking deletes an `account_memberships` row and **nothing else**. The person, their sessions,
their sets, their PRs and their routines all stay, and the owner keeps seeing every one of them.

This is not merely how it happens to work — it is what the UI promises in as many words
("their workouts stay in this household"), what the handbook promises, and what the privacy policy
promises. **Anything that makes revoke destructive breaks three documents at once**, and the
confirm dialog's own button was renamed away from "Delete" specifically so the word could not
imply otherwise.

The same holds for the Pro pause, one step weaker: it does not even remove the membership.

### ⚠️ An owner may invite, resend, revoke and unlock. An owner may NEVER set a password.

There is no `CHANGE_ANY_PASSWORD` permission, no admin path, and no support path. The member's
Profile page states this as a promise to them:

> {owner} owns this household. They can see your workouts and can remove your login.
> **They cannot see or set your password.**

`PasswordChangeService` and the absence of any sibling to it are what make that true. **If a
control to set another person's password is ever added, that sentence changes in the same commit**
— and so does the handbook, the privacy policy, and the invitation email, all of which carry it.

**Unlock is the fourth lever, and it GRANTS NOTHING.** A lockout is a throttle on guessing, not
a credential, so clearing one cannot let the owner in as that member and cannot reveal anything
about their password. That asymmetry is exactly what makes unlock safe to hand an owner when
setting a password is not, and `MembershipInviteTest#unlockingDoesNotChangeOrRevealThePassword`
is what pins it. The member always had a self-service route (wait fifteen minutes, or reset
their own password); this exists because the OWNER is the support desk.

An owner who can set a member's password can impersonate that member. That is the whole argument,
and it is why forgot-password (which proves control of the mailbox) is the only reset path.

### ⚠️ Member logins are Pro-only, so EVERY test that mints one must set the household Pro first

Registration creates a **Free** subscription. A MEMBER in a Free household is `PAUSED_PLAN` and is
refused on every route but `GET /api/auth/me` and `GET /api/billing/subscription` — correctly. So a
test that registers a household and then mints a member is testing the pause, whatever its name
says.

- **e2e:** done centrally in `addMemberLogin` (`e2e/tests/support/auth.ts`), so a new spec cannot
  forget. A spec driving the real invite flow instead must call `setBillingPlan(..., 'PRO')` itself
  — inviting is refused on Free (409).
- **Backend:** `MembershipInviteTest`, `MemberPermissionsTest` and `ChangePasswordTest` each set
  `PRO` in their setup. Seventeen e2e specs and twelve backend tests failed at once when the pause
  landed; every one of them was this.

### ⚠️ Revoking must never sign somebody out of their OTHER households

`token_version` is per-USER. Bumping it is the easy way to make a revocation take effect
immediately, and it would silently sign that person out of every unrelated household they belong
to. Use `accountAccessService.invalidate(userId, accountId)` — per membership.
`MembershipInviteTest#revokingHereDoesNotTouchTheirOtherHousehold` is what stands in the way.

The mirror of this: a plan change is per-HOUSEHOLD, so it uses `invalidateAccount`, not
`invalidateUser`. Picking the wrong axis fails quietly — the cache simply keeps answering the old
value until it expires.

### ⚠️ A control the server will refuse must not be offered

Three shipped bugs of exactly this shape, all caught late:

1. **Remove** appeared on the owner's own login row (`isSelf` was checked against a DTO that had no
   such field, so it was always true). The server's 409 was right; offering the button was not.
2. **Enable login** was offered on Free, producing an invitation whose successful path was a paused
   login.
3. A member's **exercise rename** succeeded on rows they created and 403'd on the rest, with
   nothing to tell them which — traded "always fails" for "unpredictable", which is worse to use.

The rule: if the client can know the answer, it must not render the control; if it genuinely
cannot (rename, which depends on who created a row behind an `{id}`), the refusal must **say why
and what to do instead**, via `useGatedMutation`'s `showServerMessage`.

### The offline limit that has no fix, only honesty

An offline member's device cannot be revoked. On reconnect their token resolves to no membership,
the session tears down, and their queued writes can never land. There is no server-side mechanism
that recovers this — grace periods and drain-before-revoke were both considered and rejected
(unenforceable from the server, and one is a security hole).

So the revoke confirmation **says so before the owner acts**, and the handbook repeats it. Do not
"fix" this by silently dropping the warning; the honesty is the mitigation.

## ⚠️ V72 — the one piece of schema debt, and it needs a DEPLOY rather than a commit

`users.account_id` is nullable and unread (V65, phase 2). Dropping it is the CONTRACT half of an
expand/contract and **must not ship in the same release as the expand**: production runs
`min-replicas=1`, so an old replica is still serving while Flyway removes the column, and every
`SELECT` Hibernate generates for `users` on that replica names it.

That means V72 is gated on a **production release containing phase 2 having already gone out** —
not on time passing, and not on anything in this repo. Check `worktrac-deploy`'s
`manifests/image-tag.txt` on `origin/production` before writing it.
