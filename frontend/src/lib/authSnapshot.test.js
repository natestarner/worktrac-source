import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAuthSnapshot, loadAuthSnapshot, saveAuthSnapshot } from './authSnapshot';

const SNAPSHOT = {
  user: { email: 'nate@example.com', role: 'USER' },
  account: { id: 7, defaultUnit: 'lb' },
  people: [{ id: 1, name: 'Nate' }, { id: 2, name: 'Sam' }],
  membership: { accountRole: 'OWNER', personId: 1, membersSeeEveryone: true },
};

describe('authSnapshot', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('round-trips a saved identity snapshot', () => {
    saveAuthSnapshot(SNAPSHOT);
    expect(loadAuthSnapshot()).toEqual(SNAPSHOT);
  });

  it('returns null when nothing is stored', () => {
    expect(loadAuthSnapshot()).toBeNull();
  });

  it('clears the snapshot', () => {
    saveAuthSnapshot(SNAPSHOT);
    clearAuthSnapshot();
    expect(loadAuthSnapshot()).toBeNull();
  });

  it('ignores a snapshot from an incompatible version', () => {
    localStorage.setItem('worktrac-auth-snapshot', JSON.stringify({ v: 999, user: SNAPSHOT.user }));
    expect(loadAuthSnapshot()).toBeNull();
  });

  it('ignores a corrupt snapshot instead of throwing', () => {
    localStorage.setItem('worktrac-auth-snapshot', 'not json{');
    expect(loadAuthSnapshot()).toBeNull();
  });

  it('defaults people to an empty array when absent', () => {
    saveAuthSnapshot({ user: SNAPSHOT.user, account: SNAPSHOT.account, people: undefined });
    expect(loadAuthSnapshot()).toEqual({
      user: SNAPSHOT.user,
      account: SNAPSHOT.account,
      people: [],
      membership: null,
    });
  });

  // ⚠️ THE UPGRADE PATH, and the reason the version bump is safe. Every device that has ever run
  // this app holds a v1 snapshot on the first launch after v2 deploys. Rejecting it would send all
  // of them down AuthContext's "no snapshot" branch -- stay on `loading`, retry with backoff, and
  // after three attempts show "Huddle can't reach the server". For anyone whose first launch
  // happens to be offline, that is the stranded-boot shape of
  // docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md, caused by a version bump.
  //
  // Test the UPGRADE, not a fresh profile: a brand-new install never reproduces this class of bug.
  describe('a v1 snapshot, written before member logins existed', () => {
    beforeEach(() => {
      localStorage.setItem(
        'worktrac-auth-snapshot',
        JSON.stringify({ v: 1, user: SNAPSHOT.user, account: SNAPSHOT.account, people: SNAPSHOT.people }),
      );
    });

    it('is adopted rather than discarded, so an offline boot still works', () => {
      const loaded = loadAuthSnapshot();
      expect(loaded).not.toBeNull();
      expect(loaded.user).toEqual(SNAPSHOT.user);
      expect(loaded.people).toEqual(SNAPSHOT.people);
    });

    // null means "not known yet", which useAccountAccess treats as full access -- correct, because
    // every v1 snapshot predates member logins and its holder is therefore an owner.
    it('reports an unknown membership rather than inventing one', () => {
      expect(loadAuthSnapshot().membership).toBeNull();
    });
  });
});
