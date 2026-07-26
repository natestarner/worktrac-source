import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { migrateLegacyRestTimerPrefs } from '../lib/restTimerMigration';
import { tryForceUpdate } from '../lib/swUpdate';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../lib/restTimerMigration', () => ({ migrateLegacyRestTimerPrefs: vi.fn() }));
vi.mock('../lib/swUpdate', () => ({ tryForceUpdate: vi.fn() }));
// AppShell's own job here is the update-trigger wiring -- its child components (already covered by
// their own tests) are stubbed out so a render doesn't need their full dependency graph.
vi.mock('../components/layout/Header', () => ({ default: () => null }));
vi.mock('../components/layout/PersonPillBar', () => ({ default: () => null }));
vi.mock('../components/layout/TabsNav', () => ({ default: () => null }));
vi.mock('../components/shared/Toast', () => ({ default: () => null }));
vi.mock('../components/shared/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../components/shared/PRCelebration', () => ({ default: () => null }));
vi.mock('../components/shared/RestTimerBar', () => ({ default: () => null }));
vi.mock('../components/shared/OfflineBanner', () => ({ default: () => null }));
vi.mock('../components/shared/ConnectionTroubleBanner', () => ({ default: () => null }));
vi.mock('../components/shared/OfflineRecoveryPrompt', () => ({ default: () => null }));

function baseAppState(overrides = {}) {
  return {
    activePersonId: 7,
    selectPerson: vi.fn(),
    lastTab: '/app/log',
    setLastTab: vi.fn(),
    selectedExerciseId: null,
    ...overrides,
  };
}

// Exposes react-router's navigate() to the test so a "section switch" can be driven the same way
// a real NavLink click would -- MemoryRouter's initialEntries only applies on first mount, so
// changing route mid-test needs an actual navigate() call, not a rerender with different props.
function NavCapture({ onReady }) {
  const navigate = useNavigate();
  useEffect(() => onReady(navigate), [navigate, onReady]);
  return null;
}

function renderShell({ initialPath = '/app/log' } = {}) {
  const queryClient = new QueryClient();
  let navigateFn;
  // A FRESH tree must be built for every render call (initial AND rerender) -- two requirements
  // that fight each other if you get either wrong:
  //  - Same SHAPE every time (same component types at each position). A differently-shaped tree
  //    (e.g. dropping the NavCapture sibling) shifts everything after it to a new child index;
  //    React reconciles that as a type mismatch and REMOUNTS the whole subtree from scratch (fresh
  //    AppShell instance, refs reset to the new render's values -- silently hiding the exact
  //    "did this value change" transition these tests exist to catch).
  //  - Freshly-created element objects, not the literal same ones reused by reference. React's
  //    fiber reconciler bails out of re-rendering a function component (AppShell never re-runs at
  //    all) when an element's props are REFERENTIALLY IDENTICAL to last time and nothing internal
  //    to it changed -- exactly what happens if you pass the exact same pre-built JSX tree object
  //    to `rerender()` twice, since AppShell takes no props and its behavior here depends only on
  //    the (externally mocked) useAppState() return value, which React has no visibility into.
  function buildTree() {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <NavCapture onReady={(nav) => { navigateFn = nav; }} />
          <Routes>
            <Route path="/app/log" element={<AppShell />} />
            <Route path="/app/history" element={<AppShell />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const utils = render(buildTree());
  return {
    ...utils,
    queryClient,
    navigate: (path) => act(() => navigateFn(path)),
    rerenderApp: () => act(() => utils.rerender(buildTree())),
  };
}

describe('AppShell forced-reload triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate', isPrimary: true }, { id: 8, name: 'Sam' }], refreshPeople: vi.fn() });
    migrateLegacyRestTimerPrefs.mockResolvedValue(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not call tryForceUpdate on initial mount', () => {
    useAppState.mockReturnValue(baseAppState());
    renderShell();

    expect(tryForceUpdate).not.toHaveBeenCalled();
  });

  it('switching person calls tryForceUpdate with the OUTGOING person, before navigating', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7 }));
    const { rerenderApp, queryClient } = renderShell();

    useAppState.mockReturnValue(baseAppState({ activePersonId: 8 }));
    rerenderApp();

    expect(tryForceUpdate).toHaveBeenCalledWith(queryClient, 7);
  });

  it('switching section calls tryForceUpdate for the current person', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7 }));
    const { navigate, queryClient } = renderShell({ initialPath: '/app/log' });

    navigate('/app/history');

    expect(tryForceUpdate).toHaveBeenCalledWith(queryClient, 7);
  });

  it('does not call tryForceUpdate again for a route change to the SAME path', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7 }));
    const { navigate } = renderShell({ initialPath: '/app/log' });

    navigate('/app/log');

    expect(tryForceUpdate).not.toHaveBeenCalled();
  });

  it('switching exercise calls tryForceUpdate for the current person', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7, selectedExerciseId: null }));
    const { rerenderApp, queryClient } = renderShell();

    useAppState.mockReturnValue(baseAppState({ activePersonId: 7, selectedExerciseId: 42 }));
    rerenderApp();

    expect(tryForceUpdate).toHaveBeenCalledWith(queryClient, 7);
  });

  it('regaining tab visibility calls tryForceUpdate for the current person', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7 }));
    const { queryClient } = renderShell();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(tryForceUpdate).toHaveBeenCalledWith(queryClient, 7);
  });

  it('does not call tryForceUpdate when the tab becomes hidden', () => {
    useAppState.mockReturnValue(baseAppState({ activePersonId: 7 }));
    renderShell();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(tryForceUpdate).not.toHaveBeenCalled();
  });
});
