# The durable outbox could replay out of enqueue order under lie-fi + a reload, deadlocking every queued write (2026-07-29)

- Reproduced in lower: create a custom exercise, log sets against it, with lie-fi and a page
  reload or two mixed in. On reconnect, **nothing synced** — a log-set had replayed before the
  exercise-create it depended on, so its `exerciseId` was still an unresolved temp id.
- Root cause: TanStack's shared mutation scope (`OUTBOX_SCOPE_ID`) really does serialize writes
  one at a time, but the order it enforces is **registration order into the scope's internal
  array**, not `submittedAt`. `restoreOutbox` used to split restored writes into two batches —
  hydrate every *paused* write, THEN dispatch every *not-paused* write — instead of one pass
  merged by true submit time. Under lie-fi, `navigator.onLine` stays `true`, so an
  actively-retrying write (e.g. the exercise-create) is never marked paused; if a *later*
  write (e.g. the dependent log-set) happened to be genuinely paused at persist time, a reload
  would register it into the scope ahead of the earlier create. And because a mutation whose
  `mutationFn` keeps throwing (`shouldRetryWrite` retries forever on anything but a definitive
  4xx) never leaves `state.status = 'pending'`, it never releases its scope slot — permanently
  blocking every *other* queued write behind it too, not just the misordered one.
  `flushOutbox`'s stuck-mutation retry had the identical defect (remove-then-recreate always
  re-registers at the end of the scope's array, regardless of true submit order).
- **Takeaway:** `restoreOutbox` now merges paused and not-paused writes into one
  `submittedAt`-sorted pass before registering anything, so registration order always matches
  true enqueue order. `flushOutbox`'s stuck-retry now restarts the same `Mutation` object in
  place (`m.execute(...)`) instead of removing and recreating it — safe there specifically
  because a terminal-`'error'` mutation's retryer has already fully settled, unlike a `'pending'`
  one, which could still have a live retry loop that a second `execute()` call would race rather
  than cancel. **The "editing a still-queued offline set" follow-up flagged here is now
  resolved** — see the next Resolved Incident entry below (2026-07-30): rather than finding a
  way to reorder/reuse the queued create's mutation, editing a pending set no longer touches the
  create at all. Full investigation narrative for this entry: `git log --grep="outbox" -i
  --grep="replay order" -i`.

