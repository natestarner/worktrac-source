# X-Forwarded-For spoofing bypassed every per-IP rate limit (2026-08-31)

- The 2026-07-17 incident (`2026-07-17-silent-registration-failures.md`) set
  `server.forward-headers-strategy: framework` so `getRemoteAddr()` would return the real client
  IP behind Azure Container Apps' ingress, fixing per-IP rate limits that were previously one
  shared bucket. That traded one bug for a worse one: Spring's `ForwardedHeaderFilter` trusts the
  **first** (leftmost) entry in `X-Forwarded-For` as the client, with no concept of how many hops
  to trust. Azure Container Apps' own docs (Ingress in Azure Container Apps → HTTP headers table)
  say `X-Forwarded-For` "If specified in initial request, it is appended to. Only the rightmost IP
  is provided by Azure Container Apps. Any other values must be validated by the user to prevent
  IP spoofing." ACA does not drop or sanitize what an external caller sends — it just appends its
  own observed IP after it. Combining the two meant any caller could put whatever they wanted in
  `X-Forwarded-For` and the app would believe it.
- **Confirmed live against lower, not just reasoned about:** a login POST sent with
  `X-Forwarded-For: 9.9.9.9, 8.8.8.8` was logged by `AuthRequestLoggingFilter` — and would have
  been rate-limited by `LoginRateLimiter` — as coming from `9.9.9.9`, entirely attacker-chosen.
  That fully defeats a per-IP bucket: rotate a fake leftmost value on every request and each one
  lands in its own fresh bucket. The same mechanism fed every other per-IP limiter wired through
  `AuthController`/`ContactController` (registration, password reset, resend-code, contact form),
  not just login.
- **Takeaway:** `forward-headers-strategy` is back to `none` (`application.yml`), and
  `security.ClientIpResolver.resolveClientIp` is now the **only** place a client IP is derived —
  it reads the raw `X-Forwarded-For` header itself and takes the **last** entry, the one hop ACA
  appends and vouches for, never the client-suppliable prefix in front of it. Every per-IP rate
  limiter and every IP-bearing log line goes through it; `request.getRemoteAddr()` must never be
  called directly again outside that class. `docs/azure-read-only-access.md`'s KQL pattern is what
  made this verifiable against real deployed behavior instead of staying a hypothesis: send one
  request with a crafted header, then read back what `AuthRequestLoggingFilter` actually logged.
