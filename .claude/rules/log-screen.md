---
paths:
  - "frontend/src/components/log/**"
---

# Log screen (`ExerciseDetail.jsx` and friends)

The densest file in the app for cross-cutting invariants. Full narrative:
`docs/architecture/offline-mode.md` and `docs/architecture/data-model.md`.

## ⚠️ Cross-file coupling: which endpoint you call decides `rest_seconds`

`handleLogSet` picks between two backend endpoints, and that choice — not any flag — is what
determines whether `workout_sets.rest_seconds` is recorded:

- `POST /api/people/{personId}/live-sets` (real-time logging) → backend `logLiveSet` → rest time
  **is** computed.
- `POST /api/sessions/{sessionId}/sets` (explicit "editing a specific existing session" mode) →
  backend `logSetIntoSession` → rest time is **always null**.

`logSetIntoSession` is only ever called from this explicit editing mode. If that ever changes,
the backend's rest-seconds rule silently breaks — see `.claude/rules/workout-data-model.md`.

Live-set writes should carry `clientLoggedAt` so a set logged now but synced later keeps an
honest `created_at`, and therefore an honest rest gap.

## The three pending-value fallbacks — don't remove them

`contextSessionId` (`liveSession?.id || editingSessionId`) stays `null` for a person's **entire**
offline/lie-fi stretch: the placeholder `liveSession` seeded by `logSetMutation.onMutate` is
deliberately `{ id: null }` so it can never leak in, and the real id only arrives once the
create-session round trip reaches the server. Every query keyed on it (`sessionSets`,
`sessionExerciseNote`, `exerciseSummary`) is `enabled: !!contextSessionId` and never runs during
that window.

Three fallbacks close that gap:

1. **`pendingBeforeSession`** — unsynced sets, read from the log-set mutation's own variables via
   `useMutationState`.
2. **`derivedSummary`** — the "Last time"/"Best est. 1RM" card, derived from the already-warmed
   `history` cache (`utils/exerciseSummaryFromHistory.js`). Because `history` is unpaginated this
   is the *same* answer the backend would give, not an approximation.
3. **`pendingLiveNote`** — a session note saved before/without a synced session, read from the
   pending `SAVE_NOTE` mutation's variables the same way.

`pendingLiveNote`'s "pick the newest" comparison keys off **`enqueueSeq`, not `submittedAt`** —
see `.claude/rules/offline-internals.md`.

## Editable temp rows

`editableTempIds` is what gives a paused/retrying/errored row its Edit and Delete controls
immediately instead of an indefinite "Saving…" spinner. "Saving…" is only for a write's first
in-flight attempt.
