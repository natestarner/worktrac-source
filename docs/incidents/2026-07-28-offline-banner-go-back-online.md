# The offline banner's "Go back online" button never worked, only the Settings toggle did (2026-07-28)

- `OfflineBanner`'s "Go back online" click handler only unpins offline mode if
  `probeReachability()` (a `fetch` to `/actuator/health`) succeeds, but `CorsConfig.java`
  only registered CORS for `/api/**` — `/actuator/health` never got
  `Access-Control-Allow-Origin`, so that cross-origin fetch always failed as a network error
  in every deployed environment (frontend and backend on different origins), even though the
  endpoint itself is `permitAll()` and answers fine. Settings' "Offline Mode" toggle calls the
  exact same `unpinOffline()`/`pinOffline()` functions on the exact same pin flag, but
  unconditionally, with no probe — so it always worked, making the banner button look broken
  by comparison even though there is only one offline-pin flag, not two. Local dev/preview
  never reproduced this because Vite's proxy forwards `/actuator` same-origin.
- **Takeaway:** `CorsConfig.java` now also registers `/actuator/health`. Any future
  cross-origin frontend call to a non-`/api/**` backend path (another actuator endpoint, etc.)
  needs its own registration here too — CORS is per-path, not per-security-rule; `permitAll()`
  in `SecurityConfig` only controls auth, not CORS headers.

