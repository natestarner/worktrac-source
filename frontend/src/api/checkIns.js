import { apiClient } from './client';

/**
 * One person's check-ins, newest first.
 *
 * ⚠️ What comes back depends on WHO IS ASKING, and the server decides. A trainer sees their own
 * private notes about this person; the person themselves never does. There is no client-side filter
 * to get wrong here, and there must not be one — see `CheckInRepository.findVisibleTo`.
 */
export function listCheckIns(personId) {
  return apiClient.get(`/api/people/${personId}/check-ins`);
}

/**
 * Records a check-in.
 *
 * ⚠️ TIER-3 GATED, NEVER THE DURABLE OUTBOX. The POST carries no idempotency key, so a replay would
 * record the same weigh-in twice — the same reason `createPastSession` is gated. What makes that
 * acceptable rather than lossy is the persisted draft (`checkInDraft` in AppStateContext): a gate
 * over free text without one is itself the silently-lost outcome the contract forbids.
 *
 * `visibleToPerson` is honoured only from a trainer or an assistant. A person writing on themselves
 * always gets a visible entry, whatever they send — they cannot hide something from themselves, and
 * the server forces it rather than refusing, because a 4xx here would discard the write.
 */
export function addCheckIn(personId, { enteredAt, bodyWeight, bodyWeightUnit, note, visibleToPerson }) {
  return apiClient.post(`/api/people/${personId}/check-ins`, {
    enteredAt: enteredAt ?? null,
    bodyWeight: bodyWeight ?? null,
    bodyWeightUnit: bodyWeight == null ? null : bodyWeightUnit,
    note: note ?? null,
    visibleToPerson: visibleToPerson ?? true,
  });
}

export function removeCheckIn(personId, checkInId) {
  return apiClient.delete(`/api/people/${personId}/check-ins/${checkInId}`);
}
