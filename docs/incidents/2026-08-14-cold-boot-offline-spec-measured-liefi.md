# The cold-boot-offline spec was measuring lie-fi, and was written off as rot

**Date:** 2026-08-14
**Area:** E2E harness / offline
**Spec:** `e2e/tests/offline-durability.spec.ts` → *"cold-loads from cache and boots the saved
session while fully offline"*

## Symptom

The spec failed on `expect(offlineSavedLocallyBanner(page)).toBeVisible()` — the offline banner
never appeared after a fully-offline cold load. The service worker and the auth boot were fine: the
URL assertion passed and the person pill from the identity snapshot rendered. Only the connectivity
signal was wrong.

The failure's accessibility snapshot showed the **lie-fi** banner in the offline banner's place:

```yaml
- status:
  - text: Having trouble connecting.
  - button "Go offline"
```

## What it was diagnosed as, twice, and why that was wrong

On 2026-08-10, PR #159 un-gated this file (it had run **nowhere** — excluded from the default
project, absent from branch CI, never invoked by the deploy runbook) and recorded the failure as a
**known, pre-existing rot**, in `docs/architecture/resilience.md` and in
`.claude/commands/deploy-to-lower.md`. Reasonable at the time, but it parked a red spec behind a
note saying "expected".

On 2026-08-14 a second diagnosis got further and was still wrong. It reasoned — correctly — that
the two banners are mutually exclusive on `online`:

- `ConnectionTroubleBanner` returns `null` unless `trouble && online && !pinned`
- `OfflineBanner` prints that string only when `!online && queued === 0`

so `onlineManager.isOnline()` must have been `true`. From there it noted that `onlineManager`
attaches its `online`/`offline` listeners **lazily, on first subscribe**, that `main.jsx` puts
`loadConfig().then(render)` between module-eval and that first subscriber, and concluded: the
`offline` event fires in that gap, lands with nothing attached, and is dropped forever. The fix
would have been to attach the listeners eagerly in `applyPersistedPin()`.

**That theory was coherent, matched every piece of static evidence, and was false.** It was written
up as a plan to change `offlineMode.js` — the single highest-consequence connectivity file in the
app — to fix a bug that does not exist.

## What was actually happening

A document-start probe (`page.addInitScript`) recording `navigator.onLine` and every
`online`/`offline` event, on both sides of the reload, settled it:

```
live document, right after setOffline(true):  { now: false, events: ["offline"] }
document created by the reload that follows:  { atStart: true, events: [], now: true,
                                                samples: every 500ms for 6s -> all true }
```

The `offline` event **never fires** in the new document, and `navigator.onLine` reads `true` for
that document's entire life — while every request genuinely fails, because the network emulation
*is* still in force.

That is not hard offline. That is the textbook definition of **lie-fi**: the browser claims to be
online and nothing is reachable. The app then did exactly what it is designed to do — fired
requests, watched three consecutive ones reject, tripped `reachabilityMonitor`, and showed the
connection-trouble banner. **The app was right. The spec was asserting the wrong mode.**

Root cause: CDP's `Network.emulateNetworkConditions` (what `context.setOffline` drives) flips the
renderer's network state and fires the transition on documents that **already exist**. A document
created *afterwards* starts life reading `navigator.onLine === true`, and because nothing
transitioned there is no event to correct it. A real device that is genuinely offline reports
`false` at document creation, which is what `offlineMode.js`'s `applyPersistedPin()` seeds
`onlineManager` from — so the product path was never exercised at all.

This is why it was PWA-only, and why that looked like evidence for a product bug: every other
offline spec calls `setOffline` and then asserts on the **same** document, where the emulation
works correctly. This spec is the only one that reloads while offline.

## The fix

Entirely in the harness — **no product code changed**.
`e2e/tests/support/offline.ts` gains `keepHardOfflineAcrossReload(page)`, which uses
`addInitScript` to define `navigator.onLine` as `false` for every later document. Combined with
`setOffline(true)` (which still makes the requests genuinely fail), the reload now reproduces a real
offline cold boot instead of lie-fi.

It restores the one fact the emulation drops; it does not relax the assertion. Verified by mutation:
commenting out `onlineManager.setOnline(currentNavigatorOnline())` in `applyPersistedPin()` turns
the spec red again, so it is genuinely guarding the cold-boot detection path.

The other three specs in the file deliberately **do not** use it — the override cannot be undone,
and their reconnect halves need to come back online. Their reloads therefore still land in lie-fi,
which is fine for what they assert (durable-outbox survival, ended-workout suppression, no permanent
deadlock); none of those is a claim about the connectivity signal.

## Takeaways

- **`context.setOffline` does not survive into a document created after it.** Any spec that reloads
  while offline is testing lie-fi unless it also pins `navigator.onLine`. Recorded in
  `.claude/rules/e2e-tests.md`.
- **A failing test is a claim about the app AND a claim about the harness.** Both were suspect here
  and only one was wrong. Two rounds of diagnosis reasoned exclusively about product code because
  the failure "looked like" a product failure.
- **Static reasoning that explains every observation can still be false.** The dropped-event theory
  fit all the evidence available without running anything; twenty seconds of in-page measurement
  refuted it. The plan that carried it said to confirm the mechanism before shipping — that step is
  what stopped a pointless change to the app's most dangerous file.
- **"It rotted because it ran nowhere" is a hypothesis, not a diagnosis.** Un-gating a long-dormant
  spec is exactly when a *harness* assumption is most likely to have silently drifted, because
  nothing has re-validated it either. Prefer measuring over inferring when re-enabling old tests.
- **A known-failure note is a liability with a short shelf life.** This one made a real red look
  expected for four days. If a spec must stay red, the note should carry what was measured, not
  just the conclusion.
