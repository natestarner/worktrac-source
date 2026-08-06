# A stale boot `/me` response could silently clobber a fresh login's `freshLogin` flag (2026-07-31)

- Caught by a new e2e regression test (`multi-person.spec.ts`) that failed only in the deployed
  lower environment, never locally — a page reload, then an almost-immediate logout + log back in
  as the same household, landed the just-added person on their *old* last-open tab instead of Log.
  A Playwright trace of the lower failure showed the reload's boot `/api/auth/me` call still
  in-flight when the login flow's own requests fired ~200ms later — a timing window real network
  latency (cross-origin, Azure round trips) opens up but a same-origin localhost dev/preview server
  essentially never does, which is why it never reproduced locally until the race was forced
  deterministically with a gated `page.route()` interception.
- Root cause: `AuthContext`'s boot effect (`attemptMe`, mounted with `useEffect(..., [])`) is never
  cancelled by a subsequent `logout()`/`login()` — only by the whole provider unmounting, which
  never happens within one SPA session. If that stale `/me` resolves *while genuinely signed out*
  (between `logout()`'s `setState(SIGNED_OUT)` and the real `login()` call's own final `setState`),
  its unconditional `setState({ status: 'authenticated', offline: false, ...data })` flips `status`
  back to `'authenticated'` **on its own**, with no `freshLogin` flag (that only gets set by
  `login()`/`confirmEmail()` themselves, which haven't run yet). `AppStateContext`'s hydrate effect
  reacts to this premature transition and applies `resetTab: undefined`. When the real `login()`
  call finishes moments later and sets `status` to the *same* `'authenticated'` value, React's
  effect-dependency check sees no change and the hydrate effect never re-fires — the correct
  `resetTab: true` is never applied, silently for every person except whichever one was already
  active (they land on Log anyway, via `LoginPage`'s own unconditional `navigate('/app/log')`,
  masking the bug for exactly the one case an e2e test would naively check first).
- **Takeaway:** both `AuthContext.jsx` effects that call `apiMe()` in the background (the boot
  effect and the online-reconnect reconciler) now discard their response if the current auth token
  no longer matches the token that was active when the call was made — a general "is this response
  still relevant" guard, not a `freshLogin`-specific patch, since the same staleness class could in
  principle clobber any other field a future background reconciliation writes. The regression test
  holds the boot `/me` open via a manually-released `page.route()` gate (not a fixed delay, which
  proved too timing-sensitive to reliably land the response in the exact window that matters) and
  releases it deterministically while signed out. Full investigation narrative:
  `git log --grep="stale.*me\|freshLogin" -i`.

