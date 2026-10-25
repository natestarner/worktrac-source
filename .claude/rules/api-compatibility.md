---
paths:
  - "backend/src/main/java/**/*Controller.java"
  - "backend/src/main/java/**/dto/**"
  - "backend/src/main/java/**/*Dto.java"
  - "backend/src/main/java/**/*Request.java"
  - "backend/src/main/java/**/*Response.java"
  - "frontend/src/lib/queryClient.js"
  - "frontend/src/lib/outboxPersistence.js"
---

# The API has old callers now: add, don't remove

The App Store app is the web bundle frozen into a binary, and people update when they update. A
build can keep calling the backend for **months** after the code it shipped with is gone from
`main`. On the web a stale bundle lives for hours, until the service worker swaps it, which is why
none of this was a rule before. Full narrative: `docs/architecture/native-apps.md`.

## The rule

**Changes to an endpoint, request or response are additive** until the logs show no build still
depends on the old shape (or `NATIVE_MIN_SUPPORTED_BUILD` has been raised past every build that
does, and those people have had time to update).

| Safe at any time | Needs the check below first |
|---|---|
| A new endpoint | Removing or renaming an endpoint |
| A new **optional** request field | Making a field required, or tightening its validation |
| A new response field | Removing, renaming or re-typing a response field |
| A new enum value **the client ignores when unknown** | Changing what an existing value means |

**Tightening validation is a removal.** An old build that sends what used to be valid now gets a
400, and for a durable write `shouldRetryWrite` treats a 400 as final — so the write a person
logged offline is **discarded**, not merely refused (`backend-core.md`, "Validation strictness is a
durability decision"). That is the worst version of this mistake, and nothing on the server side
shows it happened.

## Durable-write keys and their variables are API too

Writes queued offline are persisted under their mutation key with their variables, and replayed by
the **current** build's handler for that key. A rename orphans every write an older build queued.

- **Never rename or remove a key in `EVERY_SHIPPED_DURABLE_KEY`** (`lib/outboxCompatibility.test.js`,
  a frozen literal on purpose). Append new keys; keep a handler for every old one.
- **A handler must accept every variables shape its key has ever been persisted with.** Add fields
  with defaults; never reinterpret an existing one.

## What a build left on the device is API too

`lib/persistedCompatibility.test.js` freezes, as literal strings, what shipped builds persisted
(auth snapshot, app-state slices, the checkout note, the ended-workout marker, History's cached
shapes). **Changing a persisted shape means ADDING a fixture for the new one and keeping the old**;
editing an existing fixture to make the test pass deletes the only record of what is on people's
phones.

## Before removing anything: which builds are still calling?

Every request carries `X-Huddle-Client` (`ios/1.4.0+57`, `web/<build instant>`), logged as
`[client=…]` beside `[uid=…]` on every line, and `/me` logs one `Session check` line per app open
(boot, and each return to the app after five minutes away, so a resumed App Store build is counted
too; before that, an app iOS never killed was invisible to this query).
The saved query in `docs/azure-read-only-access.md` ("Which app builds are live?") counts distinct
users per build over a window. **Run it before any removal**, and say what it showed in the PR.

## Raising the minimum supported build

`NATIVE_MIN_SUPPORTED_BUILD` (and `NATIVE_APP_STORE_URL`) are Container App env vars in the deploy
repo, served on `/me` as `client`. Below the minimum, the app shows **a banner, never a gate**
(`UpdateAppBanner`): nothing is refused, nothing queued is discarded, and the outbox keeps draining
across the update because it lives in WebKit storage, which a store update keeps. A hard gate that
stopped an old build from logging would be the "signed out / blank" outcome `resilience.md` forbids.
