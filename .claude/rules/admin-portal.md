---
paths:
  - "backend/src/main/java/com/worktrac/backend/admin/**"
  - "frontend/src/routes/admin/**"
  - "frontend/src/components/admin/**"
---

# Admin portal invariants

Full narrative: `docs/architecture/admin-portal.md`.

## `ADMIN_EMAILS` is the source of truth, not `users.role`

`users.role` (`'USER'`/`'ADMIN'`) is only a cache of the env var, never edited by hand.
Reconciled in exactly two places: `AuthService.login` (promotes **and** demotes, every login) and
`AdminBootstrap` (an `ApplicationRunner` — promotes only, at startup).
`RegistrationService.confirmEmail`'s auto-login deliberately does **not** reconcile.

## Read-only, with exactly three sanctioned exceptions

`/api/admin/**` is gated at the route level (`SecurityConfig` → `hasRole("ADMIN")`), not
per-method. `AdminController`/`AdminService` are the one place in the app that deliberately reads
across every account instead of scoping to `CurrentUser.accountId()`.

Admin DTOs must **never** include `password_hash`, `pending_registrations.code_hash`, or any
hashed value — curate every field added to them.

The three exceptions (any new admin action touching app data needs the same explicit sign-off):

1. `PUT /api/admin/registration-alert-settings` — alerting *configuration*, not app data.
2. `DELETE /api/admin/test-data` — see below.
3. `POST` / `DELETE /api/admin/accounts/{id}/comp` — granting a household a paid plan. See below.

**Keep a new admin route on `AdminController`.** Both admin controllers are on
`HandlerPermissionCoverageTest`'s exempt list by class name, so a route on a *new* class fails the
build until it is listed there — and the reason it can be exempt at all is the route-level gate
above. `TestDataAdminController` is separate only because it needs `@Profile` gating.

## Granting a paid plan (`CompGrantService`) — exception #3

Reasoning and the reversal it represents: `docs/architecture/billing.md`. Invariants that must hold:

- **⚠️ The acting admin comes from `CurrentUser`, never from the request body.** `AdminCompRequest`
  carries the tier, the band and the note — and deliberately no actor field, no account id and no
  `comped` flag. An audit trail a caller can write their own name into is not one.
  `AdminAuthorizationTest#theAuditTrailNamesTheAuthenticatedAdminAndIgnoresASelfReportedOne` sends
  a spoofed `actorEmail` and is what should start failing if such a field is ever added.
- **Every grant and revoke writes a `billing_events` row** (`COMP_GRANTED` / `COMP_REVOKED`) naming
  that admin. The audit trail is what makes this capability accountable rather than merely gated,
  and it is what replaced the record a deploy used to leave behind.
- **⚠️ A comp does not stop the money**, so granting one to a household with a live Stripe
  subscription is a **409**, never a warning — they would keep being charged for a plan they were
  just given. `AdminAccountDto.compGrantable` is the server's own precomputed answer so the client
  disables the control instead of offering a doomed write (`member-access.md`).
- **That gate asks `isPayingThroughStripe`, not `isEntitled`.** `isEntitled` is true for an
  already-comped row and would latch every comped household out of editing its own grant.
- **No `PlusUpgradedEvent`** — nobody bought anything. `AccountPlanChangedEvent` *is* published
  (per-household `invalidateAccount`), and both directions are asserted.
- `COMPED_EMAILS` and `CompBootstrap` are **retired**. `CompGrantService` is the only production
  writer of `comped` / `comped_plan`.

## Test-data cleanup (`TestDataCleanupService`)

- **The real safety net is `TestDataAdminController`'s `@Profile({"local", "lower"})`** — these
  routes don't exist as beans outside local/lower, so this can never run in production regardless
  of what the UI hides. Route-level `hasRole('ADMIN')` on top of that.
- **⚠️ Cross-file coupling:** `CURRENT_EMAIL_PATTERN` (`huddle+%@starner.co`) and
  `LEGACY_EMAIL_PATTERN` (`e2e-%@example.com`) are independently-maintained copies of the literal
  the e2e suite generates in `e2e/tests/support/auth.ts`'s `registerHousehold`. **These must always
  change together** — they are not derived from one shared constant. `CURRENT_EMAIL_PATTERN` is
  deliberately broader than the `huddle+e2e-` prefix so it also catches
  `live-email-canary.spec.ts`'s `huddle+livewiretest-...` address.
- **Genuine bulk SQL deletes, not a per-account loop.** Spring Data's derived
  `deleteByAccount_Id`/`deleteByEmailLike` load and remove entities one at a time; once lower had
  hundreds of e2e accounts that exceeded the frontend timeout, and the client timing out does not
  cancel the still-running backend transaction. Use `deleteByAccountIdIn` /
  `deleteByEmailLikeBulk` / `deleteAllByIdInBatch`. Order still matters for FK reasons.
  See `docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md`.
- **Preview before delete** — `GET /api/admin/test-data/preview` returns the same DTO the `DELETE`
  does, so the confirm dialog shows exactly what's about to go. Deliberate choice over a plain
  "are you sure?".

## Frontend

- `AdminRoute` redirects a non-admin (even if authenticated) to `/app/log` rather than showing an
  access-denied screen, so the portal's existence isn't revealed to ordinary users.
- Standalone `AdminShell` layout under `/admin`, not a tab inside `AppShell`/`TabsNav`.
- `AdminShell` mounts `Toast`/`ConfirmDialog` itself (unlike the rest of `AppShell`'s globals,
  which are workout-specific) — without them, `openConfirm()`/`showToast()` from an admin route
  would update `UIContext` state nothing in the admin tree renders.
