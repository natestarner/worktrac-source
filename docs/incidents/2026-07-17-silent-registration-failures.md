# Silent registration failures in production (2026-07-17)

- Two registration attempts in production left zero trace anywhere (no email sent, no backend
  log output) — traced to the backend logging almost nothing on the register/confirm/resend
  path. Root-causing surfaced a real independent bug: `AuthController` read the client IP via
  `servletRequest.getRemoteAddr()` with nothing trusting `X-Forwarded-For`, so behind Azure
  Container Apps' reverse-proxy ingress the "per-IP" registration/password-reset rate limit was
  accidentally one shared bucket for every external user, not per-household.
- **Takeaway:** `server.forward-headers-strategy: framework` (`application.yml`) now trusts
  `X-Forwarded-For`; `RegistrationService` and a front-door `AuthRequestLoggingFilter` on
  `/api/auth/**` log every register/confirm/resend attempt and outcome (email only, never
  password/code), so a repeat is diagnosable instead of a dead end. Full investigation
  narrative and the Spring Security filter-ordering gotcha hit while wiring this up:
  `git log --grep="X-Forwarded-For" -i` (PR #80).
- ⚠️ **Superseded 2026-08-31:** trusting `X-Forwarded-For` via `forward-headers-strategy: framework`
  turned out to be spoofable and was replaced by `security.ClientIpResolver`. See
  `2026-08-31-xff-spoofing-bypassed-per-ip-rate-limits.md`.

