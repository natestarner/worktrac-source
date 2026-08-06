---
paths:
  - "backend/src/main/java/**"
---

# Backend invariants

Applies to all backend production code. Subsystem-specific rules load alongside this one.

## Multi-tenancy — the core product guarantee

- The app keeps each person's workout data (exercises, sets, reps, history) **fully separate**.
  Every workout-related table scopes rows to a specific person, and **every query must filter by
  the active person**.
- Account scoping goes through `CurrentUser.accountId()`. The **only** deliberate exception in
  the whole app is `AdminController`/`AdminService`, which reads across every account on purpose.
  If you are writing a cross-account query anywhere else, it is a bug.

## Time

- Use the injected `Clock` bean (`config/ClockConfig.java`), **never `Instant.now()`**. This is
  what makes `rest_seconds`, session staleness, and rate limiting deterministically testable with
  `MutableClock`.

## Configuration rules

- CORS is configured globally in `CorsConfig.java` — **do not** add `@CrossOrigin` to individual
  controllers. Allowed origins come from the `CORS_ALLOWED_ORIGINS` environment variable, never
  hardcoded values. CORS is registered **per path**: a cross-origin call to any non-`/api/**`
  backend path needs its own registration here (`/actuator/health` already has one — it was
  missing once and silently broke the offline banner; see
  `docs/incidents/2026-07-28-offline-banner-go-back-online.md`).
- Never set `spring.jpa.hibernate.ddl-auto` to anything other than `validate`. Schema changes go
  in Flyway migrations, never manual DDL.
- `server.forward-headers-strategy: framework` is load-bearing — it makes `X-Forwarded-For`
  trusted so per-IP rate limits are actually per-user behind Azure Container Apps' ingress,
  not one shared bucket.

## Error handling

- `GlobalExceptionHandler` (`common/`) must answer **every** failure mode with an honest
  400/503/500. An exception that escapes it reaches the servlet container's `/error`
  re-dispatch, which re-runs the stateless security chain as anonymous and turns a benign
  failure into a **401** — which the frontend reads as "session invalid" and logs the user out.
  A DB/backend outage must always degrade to "queue and retry", never to "you are signed out".
  See `docs/incidents/2026-07-27-db-outage-forced-logout.md`.

## Style

- Java: 4-space indentation, Spring Boot conventions.
