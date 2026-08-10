---
description: Review the current diff against the degraded-conditions contract — the four-axis condition matrix, the mechanism catalog, and the register of sanctioned divergences. Use when the user says "resilience review", "check this against the conditions", "does this work offline", or before shipping a change that touches writes, caching, connectivity, or persisted state.
---

# /resilience-review

Reviews the working diff for one thing only: **does this behave the same in every condition?**
It does not look for general bugs or style — use `/code-review` for that.

Read `.claude/rules/resilience.md` first. It is the source of truth for the matrix, the mechanism
catalog, and the register. This command is the procedure for applying it.

## 1. Establish the diff

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

If the branch is `main` or the diff is empty, review uncommitted work (`git diff HEAD`) and say
which you used. Skip pure-documentation diffs with a one-line note.

## 2. Classify every change

For each changed hunk, decide which it is — this determines what to check:

| Kind | Signals |
|---|---|
| **A write** | calls `useDurableMutation` / `useGatedMutation` / `dispatchDurableWrite`, or an `api/*` write |
| **A read** | a `useQuery`, a new query key, anything consuming cached data |
| **Persisted state** | `appStatePersistence`, `PERSON_DEFAULTS`, a new localStorage/IndexedDB key, `queryClient` persist options |
| **Connectivity logic** | `useOnlineStatus`, `onlineManager`, `offlineMode`, `reachabilityMonitor`, the outbox |
| **A display value** | anything rendering something a write produced |
| **Backend** | a controller/service/exception path |

## 3. Run the matrix

For each changed behavior, answer concretely — not "should be fine", but *what happens*:

**A. Reachability** — online; slow-but-alive (past the client's abort); lie-fi (rejected fetches);
hard offline; **user-pinned offline** (different from hard offline); flapping.

**B. Server answers unsuccessfully** — cold start 503 (**does not trip lie-fi** — a fulfilled
response resets the counter); DB down (must degrade to queue-and-retry, never sign-out); pool
exhausted (presents as lie-fi); definitive 4xx.

**C. Client lifecycle** — a reload at the worst instant (the persister is throttled 1s); the SW's
silent forced reload (always available just after a deploy); storage unavailable; multi-tab;
person or account switch mid-outage.

**D. State from an earlier world** — a persisted slice predating this change (**test the upgrade
path, not a fresh profile**); a restored cache entry that looks fresh; unresolved temp ids; a
render-time throw.

Skip axes that genuinely cannot apply, and **say which you skipped and why**. Silently skipping is
the failure mode this command exists to prevent.

## 4. Check the mechanism catalog

Does the change introduce a *second* way to do a job that already has one? Check the catalog
table in `.claude/rules/resilience.md`. Flag: a bare `useMutation`, a raw `fetch`, `navigator.onLine`,
ordering by `submittedAt`, a per-mutation `retry`, `status === 'pending'` as an unsynced test, a
per-screen offline fallback instead of a cache-warm key.

## 5. Check the register

Does the change add a branch on connectivity? If it is **not** on the register in
`.claude/rules/resilience.md`, that is a finding — either remove the branch or add a register
entry with a reason.

Does the change *remove or simplify* something on the register? That is a **high-severity**
finding. Several past regressions were exactly this. Name the register row and the incident.

## 6. Check the proof

- Does a user-visible flow have a parity test (`e2e/tests/support/parity.ts`)?
- Could that test pass vacuously? A parity test that never fails guards nothing.
- Does the area have a `docs/incidents/` entry that should have been read first?
- Service-worker-dependent behavior → `offline-durability.spec.ts` (`npm run test:pwa`).

## 7. Run the mechanical guard

```bash
bash scripts/check-resilience-invariants.sh
```

## Output

Findings ordered most-severe first. For each: **file:line**, which axis or register row it
violates, a concrete failure scenario (inputs/state → wrong behavior), and the sanctioned
mechanism to use instead. Then a short matrix summary — which axes were checked, which were
skipped and why. End with the mechanical guard's result.

If nothing is wrong, say so plainly and still print the matrix summary — the summary is the
deliverable even when the verdict is clean.
