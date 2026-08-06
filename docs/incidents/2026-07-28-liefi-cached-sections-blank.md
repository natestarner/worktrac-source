# Cached sections went blank during a prolonged lie-fi session (2026-07-28)

- During lie-fi (backend unreachable, `navigator.onLine` still true), cached sections
  (History, session/exercise data) rendered correctly at first but went blank after
  extended use, even though nothing was ever lost server-side. Two independent, reasonable
  behaviors combined: `swUpdate.js`'s `tryForceUpdate` silently reloads the page on ordinary
  navigation (person/section/exercise switch) whenever a new service-worker build is
  available -- invisible to the user since `AppStateContext` seamlessly restores the same
  screen/position. Meanwhile `queryClient.js`'s `persistOptions` had no
  `shouldDehydrateQuery` override, so TanStack's default (`status === 'success'`) dropped a
  query from the next persisted IndexedDB snapshot the instant any background refetch
  failed -- even though `data` itself stayed intact in memory. Ordinary lie-fi background
  refetches (window-focus, the offline-cache-warm cycle) kept flipping more queries into
  that state over time. If a silent reload landed while a query was in it, `hydrate()` had
  nothing on disk to restore, so the section booted data-less and the immediate real fetch
  failed too (backend still down).
- **Takeaway:** `shouldDehydrateQuery` (`queryClient.js`) now persists a query whenever it
  holds usable `data`, regardless of its last fetch attempt's status -- reproduced and
  verified via a `dehydrate`/`hydrate` round-trip test against the app's real
  `persistOptions` (see `queryClient.test.js`) before and after the fix, confirming both the
  bug and the fix mechanically rather than by inspection alone.

