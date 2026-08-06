# A local DB outage force-logged the user out instead of degrading gracefully (2026-07-27)

- Reproduced locally (log in, take the database down, create an exercise, log a set against it,
  wait): the app eventually got a **401 from `live-sets`** and bounced to `/login`, even though the
  session itself was never actually invalid. Three independent, stacking causes:
  1. An unhandled exception on an authenticated route (a malformed request body, a
     `DataAccessException`) escaped `GlobalExceptionHandler` and hit the servlet container's
     `/error` re-dispatch, which re-runs the stateless security chain as **anonymous** and turns
     even a benign failure into a 401 — the exact mechanism already documented on
     `SecurityConfig`'s `exceptionHandling` block, but nothing upstream of it actually prevented an
     exception from reaching that path. Concretely reachable because an exercise-create that
     couldn't reach the DB used to give up after a bounded number of retries without ever
     recording its temp→real id mapping, so a queued log-set replayed with the raw
     `"temp-exercise-<uuid>"` placeholder string, which the backend's `Long`-typed field couldn't
     parse.
  2. `flushOutbox()`/`restoreOutbox()` replayed queued writes with no check for a live session, so
     a write dispatched with a stale/cleared token 401'd and could tear a *freshly re-established*
     session back down — a handful of stuck queued writes turned re-login into a bounce loop.
  3. A cold boot whose `/me` call failed with no saved identity snapshot yet available signed the
     user out immediately, even though the failure was a transient outage, not an invalid token.
- **Takeaway:** `GlobalExceptionHandler` now answers every failure mode (malformed request, DB
  outage, anything else unhandled) with an honest 400/503/500 instead of letting it escape to
  `/error`. Durable writes retry transient failures forever instead of giving up (see Offline Mode
  Notes), and a dependent write refuses to dispatch with an unresolved temp id. `flushOutbox`/
  `restoreOutbox` gate on an authenticated token, and `/me`'s boot retry backs off instead of
  signing out on a transient failure. The general lesson: a DB/backend outage must always degrade
  to "queue and retry," never to "the session is invalid" — those are different failure classes and
  conflating them is what turns an infrastructure blip into a data-loss-flavored user-facing bug.
  Full investigation narrative: `git log --grep="never logs the user out\|login loop" -i`.

