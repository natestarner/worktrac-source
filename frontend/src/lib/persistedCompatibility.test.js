import { beforeEach, describe, expect, it } from 'vitest';
import { loadAuthSnapshot } from './authSnapshot';
import { loadAppState } from './appStatePersistence';
import { readPendingCheckout } from './pendingCheckout';
import { isSessionEnded } from './endedSessions';
import { flattenHistory } from './historySync';
import { PERSON_DEFAULTS, reducer, initialState } from '../context/AppStateContext';

// What builds that are ALREADY on people's phones left on the device, frozen as literal strings.
//
// The App Store app updates when its owner updates, so someone can jump from 1.0 straight to 1.8 and
// open the new build against whatever 1.0 wrote -- skipping every format change in between, with no
// web deploy's few hours of overlap to smooth it over (checklist 7.4, api-compatibility.md). Each
// fixture below is exactly what a shipped build persisted. A change that can no longer read one of
// them fails here, before it strands an installed app on a white screen or the login page.
//
// ⚠️ Never edit a fixture to make a test pass. Add a new one for the new shape and keep the old:
// both are on someone's device. outboxCompatibility.test.js does the same for queued writes.
const SHIPPED = {
  // Auth snapshot v1: before member logins (no `membership`) and before the App Store build floor
  // (no `client`). Adopted, never discarded -- see authSnapshot.js.
  authV1: JSON.stringify({
    v: 1,
    user: { id: 7, email: 'nate@example.com' },
    account: { id: 3, name: 'Starner' },
    people: [{ id: 11, name: 'Nate', isPrimary: true }],
  }),
  // Auth snapshot v2 as the first App Store build writes it.
  authV2: JSON.stringify({
    v: 2,
    user: { id: 7, email: 'nate@example.com' },
    account: { id: 3, name: 'Starner' },
    people: [{ id: 11, name: 'Nate', isPrimary: true }],
    membership: { role: 'OWNER', personId: 11, status: 'ACTIVE' },
    client: { minSupportedNativeBuild: 0, appStoreUrl: null },
  }),
  // App state, schema version 1, with a slice holding only the fields an early build knew about.
  appState: JSON.stringify({
    version: 1,
    activePersonId: 11,
    byPerson: { 11: { lastTab: '/app/history' } },
  }),
  pendingCheckout: JSON.stringify({ sessionId: 'cs_shipped', at: Date.parse('2026-10-21T12:00:00Z') }),
  endedSessions: JSON.stringify(['901', '902']),
};

beforeEach(() => localStorage.clear());

describe('state persisted by shipped builds still reads', () => {
  it('auth snapshot v1 (no membership, no client)', () => {
    localStorage.setItem('worktrac-auth-snapshot', SHIPPED.authV1);
    const snapshot = loadAuthSnapshot();
    expect(snapshot.user.id).toBe(7);
    expect(snapshot.membership).toBeNull();
    expect(snapshot.client).toBeNull();
  });

  it('auth snapshot v2 with the App Store build floor', () => {
    localStorage.setItem('worktrac-auth-snapshot', SHIPPED.authV2);
    expect(loadAuthSnapshot().client).toEqual({ minSupportedNativeBuild: 0, appStoreUrl: null });
  });

  // Every field added to PERSON_DEFAULTS since the slice was written must hydrate as its default,
  // never undefined (docs/incidents/2026-08-08-trends-hover-blank-page.md).
  it('an app-state slice missing every field added since', async () => {
    localStorage.setItem('worktrac-appstate-3:7', SHIPPED.appState);
    const restored = await loadAppState(3, 7);
    expect(restored.activePersonId).toBe(11);

    const state = reducer(initialState, { type: 'HYDRATE', ...restored });
    const slice = state.byPerson[11];
    expect(slice.lastTab).toBe('/app/history');
    for (const key of Object.keys(PERSON_DEFAULTS)) {
      expect(slice[key], `PERSON_DEFAULTS.${key}`).not.toBeUndefined();
    }
  });

  it('the hosted-checkout note', () => {
    localStorage.setItem('worktrac-pending-checkout', SHIPPED.pendingCheckout);
    expect(readPendingCheckout(Date.parse('2026-10-21T13:00:00Z'))).toBe('cs_shipped');
  });

  it('the ended-workout marker', () => {
    localStorage.setItem('worktrac-ended-session:11', SHIPPED.endedSessions);
    expect(isSessionEnded(11, 902)).toBe(true);
  });

  // History held in the query cache: the flat array from before the month-by-month sync, and the
  // synced shape (format 2). Both must render.
  it('History in both cached shapes', () => {
    const flat = [{ id: 2, startedAt: '2026-10-02T10:00:00Z' }, { id: 1, startedAt: '2026-09-01T10:00:00Z' }];
    expect(flattenHistory(flat)).toBe(flat);
    expect(
      flattenHistory({
        format: 2,
        months: {
          '2026-09': { fp: 'a', sessions: [flat[1]] },
          '2026-10': { fp: 'b', sessions: [flat[0]] },
        },
        checked: {},
        fullSyncedAt: 0,
      }).map((s) => s.id),
    ).toEqual([2, 1]);
  });
});
