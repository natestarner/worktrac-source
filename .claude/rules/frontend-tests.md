---
paths:
  - "frontend/src/**/*.test.js"
  - "frontend/src/**/*.test.jsx"
  - "frontend/src/test/**"
---

# Frontend testing rules

Vitest + React Testing Library. Full narrative: `docs/architecture/testing.md`.

- Minimum bar: a test for any new endpoint or user-facing feature.
- The service worker is **disabled in Vitest** (and in `vite dev`) — anything depending on
  precached app-shell behaviour can't be covered here; it belongs in
  `e2e/tests/offline-durability.spec.ts` (`npm run test:pwa`).
- Prefer reproducing an offline/persistence bug against the app's **real** `persistOptions` via a
  `dehydrate`/`hydrate` round trip (see `lib/queryClient.test.js`) rather than asserting by
  inspection — that's what mechanically confirmed both the bug and the fix in
  `docs/incidents/2026-07-28-liefi-cached-sections-blank.md`.
- Regression coverage for outbox ordering lives in `lib/outboxPersistence.test.js` and must keep
  testing the **reload-reconstruction** path (double reload under lie-fi, connectivity
  *transitions*, and a scrambled persisted array proving the sort actually re-orders), not just
  the live serial scope.
