import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAuthSnapshot, loadAuthSnapshot, saveAuthSnapshot } from './authSnapshot';

const SNAPSHOT = {
  user: { email: 'nate@example.com', role: 'USER' },
  account: { id: 7, defaultUnit: 'lb' },
  people: [{ id: 1, name: 'Nate' }, { id: 2, name: 'Sam' }],
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
    expect(loadAuthSnapshot()).toEqual({ user: SNAPSHOT.user, account: SNAPSHOT.account, people: [] });
  });
});
