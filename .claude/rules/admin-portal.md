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

## Read-only, with exactly two sanctioned exceptions

`/api/admin/**` is gated at the route level (`SecurityConfig` → `hasRole("ADMIN")`), not
per-method. `AdminController`/`AdminService` are the one place in the app that deliberately reads
across every account instead of scoping to `CurrentUser.accountId()`.

Admin DTOs must **never** include `password_hash`, `pending_registrations.code_hash`, or any
hashed value — curate every field added to them.

The two exceptions (any new admin action touching app data needs the same explicit sign-off):

1. `PUT /api/admin/registration-alert-settings` — alerting *configuration*, not app data.
2. `DELETE /api/admin/test-data` — see below.

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
