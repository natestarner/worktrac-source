import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateProvider, useAppState } from './AppStateContext';
import { useAuth } from './AuthContext';
import { loadAppState } from '../lib/appStatePersistence';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/appStatePersistence', () => ({
  loadAppState: vi.fn(),
  saveAppState: vi.fn(() => true),
}));

function Harness() {
  const { hydrated, activePersonId } = useAppState();
  return (
    <div>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <span data-testid="active">{String(activePersonId)}</span>
    </div>
  );
}

const AUTHED = { status: 'authenticated', account: { id: 42 }, people: [{ id: 7 }], freshLogin: false };

describe('AppStateContext hydration gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAppState.mockResolvedValue({ activePersonId: 7, byPerson: { 7: {} } });
  });

  it('reports hydrated on public pages so login and register are never gated', async () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', account: null, people: [], freshLogin: false });
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    expect(screen.getByTestId('hydrated').textContent).toBe('true');
    expect(loadAppState).not.toHaveBeenCalled();
  });

  // The empty-#root frame. `hydrated` used to be a plain boolean that the unauthenticated branch
  // also set, so on the very first render after `status` flipped to 'authenticated' it still read
  // `true` while the reducer still held initialState. ProtectedRoute let <Outlet/> through on that
  // render, AppShell found activePersonId === null and returned null -- a literally empty #root.
  // Observed live in a real browser on 2026-09-02 (`SHELL activePersonId=null`).
  it('does NOT report hydrated on the first authenticated render, before this account is loaded', () => {
    useAuth.mockReturnValue(AUTHED);
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    // Synchronous read of the very first commit -- no waitFor, that is the whole point.
    expect(screen.getByTestId('hydrated').textContent).toBe('false');
    expect(screen.getByTestId('active').textContent).toBe('null');
  });

  it('reports hydrated once this account\'s slice is actually in state', async () => {
    useAuth.mockReturnValue(AUTHED);
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'));
    expect(screen.getByTestId('active').textContent).toBe('7');
  });

  it('re-gates when a different account becomes active, rather than reusing the first one\'s answer', async () => {
    useAuth.mockReturnValue(AUTHED);
    const { rerender } = render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'));

    let resolveSecond;
    loadAppState.mockReturnValue(new Promise((r) => { resolveSecond = r; }));
    // The second household's own people, or RECONCILE_PEOPLE would (correctly) drop the restored
    // active person as not belonging to this account.
    useAuth.mockReturnValue({ ...AUTHED, account: { id: 99 }, people: [{ id: 12 }] });
    rerender(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );

    expect(screen.getByTestId('hydrated').textContent).toBe('false');
    resolveSecond({ activePersonId: 12, byPerson: { 12: {} } });
    await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'));
    expect(screen.getByTestId('active').textContent).toBe('12');
  });

  // loadAppState swallows its own storage failures, but if it ever did reject, a `hydrated` stuck
  // at false is a boot skeleton that never resolves -- the same shape as the stalled boot.
  it('still reports hydrated if loading the persisted slice rejects outright', async () => {
    useAuth.mockReturnValue(AUTHED);
    loadAppState.mockRejectedValue(new Error('storage exploded'));
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'));
  });
});
