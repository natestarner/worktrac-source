// When the server confirmed each logged set, by its tempId -- the hand-off between "still queued"
// and "in History" for the PRs board and Trends (hooks/useStatsFromHistory.js).
//
// A set leaves the queue the moment its save succeeds, but History only holds it once the refresh
// that save triggers lands. Without this, a set was in neither for that round trip and a record set
// blinked off the board. useSessionEntries' `confirmedAfter` keeps a confirmed set folded in until
// History has been fetched after its confirmation: LOG_SET's onSettled records the time here and
// then calls refreshHistory, which cancels every older History fetch -- so the first History to
// land after the confirmation is one that holds the set.
//
// In memory only, deliberately. After a reload the mutation that carried the set is gone too, and
// History is refreshed at boot; there is nothing left to hand off.

const confirmedAt = new Map();
const KEEP_MS = 10 * 60 * 1000;

export function markSetConfirmed(tempId, now = Date.now()) {
  if (!tempId) return;
  confirmedAt.set(String(tempId), now);
  for (const [id, at] of confirmedAt) if (now - at > KEEP_MS) confirmedAt.delete(id);
}

export function setConfirmedAt(tempId) {
  return tempId ? confirmedAt.get(String(tempId)) ?? null : null;
}
