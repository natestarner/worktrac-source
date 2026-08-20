import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { useUI } from '../context/UIContext';
import { migrateLegacyRestTimerPrefs } from '../lib/restTimerMigration';
import { tryForceUpdate } from '../lib/swUpdate';
import { REFRESH_INDICATOR_SLOT_ID } from '../components/shared/RefreshIndicator';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../lib/restTimerMigration', () => ({ migrateLegacyRestTimerPrefs: vi.fn() }));
vi.mock('../lib/swUpdate', () => ({ tryForceUpdate: vi.fn() }));
// AppShell's own job here is the update-trigger wiring and the chrome composition -- its child
// components (already covered by their own tests) are stubbed out so a render doesn't need their
// full dependency graph. The three chrome bars carry a `data-chrome` marker rather than rendering
// null, because WHICH of them lands inside the sticky .app-chrome box is AppShell's decision and
// nothing else asserts it.
vi.mock('../components/layout/Header', () => ({ default: () => <div data-chrome="header" /> }));
vi.mock('../components/layout/PersonPillBar', () => ({ default: () => <div data-chrome="person" /> }));
vi.mock('../components/layout/TabsNav', () => ({ default: () => <div data-chrome="tabs" /> }));
vi.mock('../components/shared/Toast', () => ({ default: () => null }));
vi.mock('../components/shared/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../components/shared/PRCelebration', () => ({ default: () => null }));
vi.mock('../components/layout/SessionBar', () => ({ default: () => null }));
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
    restTimersByPerson: {},
    setRestTimer: vi.fn(),
    ...overrides,
  };
}

function baseUI(overrides = {}) {
  return { restTimers: {}, startRestTimer: vi.fn(), ...overrides };
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
    useUI.mockReturnValue(baseUI());
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

// jsdom computes no layout, so these assert the STRUCTURE that produces the sticky behaviour --
// which bar sits inside the single `position: sticky` box -- and leave the pixels to
// e2e/tests/sticky-chrome.spec.ts, which scrolls a real browser.
describe('AppShell sticky chrome', () => {
  const solo = [{ id: 7, name: 'Nate', isPrimary: true }];
  const household = [{ id: 7, name: 'Nate', isPrimary: true }, { id: 8, name: 'Sam' }];

  function mountWith(people) {
    useAuth.mockReturnValue({ people, refreshPeople: vi.fn() });
    useAppState.mockReturnValue(baseAppState());
    return renderShell();
  }

  const inChrome = (container) =>
    [...container.querySelectorAll('.app-chrome [data-chrome]')].map((el) => el.dataset.chrome);
  const allBars = (container) => [...container.querySelectorAll('[data-chrome]')].map((el) => el.dataset.chrome);

  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue(baseUI());
    migrateLegacyRestTimerPrefs.mockResolvedValue(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it('sticks only the tab bar for a one-person household', () => {
    const { container } = mountWith(solo);

    expect(inChrome(container)).toEqual(['tabs']);
  });

  it('sticks the person bar too once a second person exists', () => {
    const { container } = mountWith(household);

    expect(inChrome(container)).toEqual(['person', 'tabs']);
  });

  it('never sticks the Huddle lockup, whatever the household size', () => {
    expect(inChrome(mountWith(solo).container)).not.toContain('header');
    expect(inChrome(mountWith(household).container)).not.toContain('header');
  });

  // The bars only change which box they live in -- what someone SEES at the top of an unscrolled
  // page must be identical either way. Moving the person bar out of the chrome by rendering it
  // somewhere else in the flow would satisfy the assertions above and break this one.
  it('renders the same visual order in both cases', () => {
    expect(allBars(mountWith(solo).container)).toEqual(['header', 'person', 'tabs']);
    expect(allBars(mountWith(household).container)).toEqual(['header', 'person', 'tabs']);
  });

  // The load-bearing half of keeping the sticky region a contiguous suffix: the refresh
  // indicator's slot is absolutely positioned on the chrome's bottom edge, so if it ever fell
  // outside the sticky box it would scroll away with the page (see RefreshIndicator.jsx).
  it('keeps the refresh-indicator slot inside the sticky box in both cases', () => {
    for (const people of [solo, household]) {
      const { container } = mountWith(people);
      expect(container.querySelector(`.app-chrome #${REFRESH_INDICATOR_SLOT_ID}`)).not.toBeNull();
    }
  });

  it('moves the person bar into the chrome when a household grows from one to two', () => {
    useAppState.mockReturnValue(baseAppState());
    useAuth.mockReturnValue({ people: solo, refreshPeople: vi.fn() });
    const { container, rerenderApp } = renderShell();
    expect(inChrome(container)).toEqual(['tabs']);

    useAuth.mockReturnValue({ people: household, refreshPeople: vi.fn() });
    rerenderApp();

    expect(inChrome(container)).toEqual(['person', 'tabs']);
    expect(allBars(container)).toEqual(['header', 'person', 'tabs']);
  });
});

// Resuming a rest timer that was running when the document died. UIContext is in-memory, so the
// persisted start in AppStateContext is the only record it survives on.
//
// ⚠️ This ran for the ACTIVE person only, and that shipped a bug: with two people in the household,
// reloading while person A was selected blanked person B's ring entirely -- and it came back only
// if you switched to B, which restored their timer as a side effect of them becoming active. The
// ring exists precisely to answer "is anyone ELSE ready to go", so the one person it was guaranteed
// to fail for was the one it was built for. A single-person household could never reproduce it.
describe('AppShell rest timer resume', () => {
  const NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate', isPrimary: true }, { id: 8, name: 'Sam' }], refreshPeople: vi.fn() });
    useUI.mockReturnValue(baseUI());
    migrateLegacyRestTimerPrefs.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resumes EVERY person's timer, not just the active one's", () => {
    const startRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ startRestTimer }));
    useAppState.mockReturnValue(
      baseAppState({
        activePersonId: 7,
        restTimersByPerson: {
          7: { startedAt: NOW - 30000, targetSeconds: 90 },
          8: { startedAt: NOW - 45000, targetSeconds: 120 },
        },
      }),
    );

    renderShell();

    expect(startRestTimer).toHaveBeenCalledWith(7, 90, NOW - 30000);
    // The one that used to be dropped on the floor.
    expect(startRestTimer).toHaveBeenCalledWith(8, 120, NOW - 45000);
  });

  it('resumes a non-active person even when the active person has no timer at all', () => {
    const startRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ startRestTimer }));
    useAppState.mockReturnValue(
      baseAppState({ activePersonId: 7, restTimersByPerson: { 8: { startedAt: NOW - 10000, targetSeconds: 90 } } }),
    );

    renderShell();

    expect(startRestTimer).toHaveBeenCalledWith(8, 90, NOW - 10000);
  });

  it('falls back to the default target for a slice persisted before targets existed', () => {
    const startRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ startRestTimer }));
    useAppState.mockReturnValue(
      baseAppState({ restTimersByPerson: { 7: { startedAt: NOW - 5000, targetSeconds: null } } }),
    );

    renderShell();

    expect(startRestTimer).toHaveBeenCalledWith(7, 90, NOW - 5000);
  });

  // Close the app on Friday, reopen on Monday: a naive resume computes three days of elapsed and
  // lights the ring for a workout that ended before the weekend.
  it('discards a start already past the ceiling instead of resuming it', () => {
    const startRestTimer = vi.fn();
    const setRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ startRestTimer }));
    useAppState.mockReturnValue(
      baseAppState({ setRestTimer, restTimersByPerson: { 8: { startedAt: NOW - 3 * 24 * 60 * 60 * 1000, targetSeconds: 90 } } }),
    );

    renderShell();

    expect(startRestTimer).not.toHaveBeenCalled();
    // Cleared against THAT person, not whoever happens to be active -- the whole reason the action
    // takes a personId.
    expect(setRestTimer).toHaveBeenCalledWith({ personId: 8 });
  });

  it('does not re-adopt a timer that is already running in memory', () => {
    const startRestTimer = vi.fn();
    useUI.mockReturnValue(
      baseUI({ startRestTimer, restTimers: { 7: { startedAt: NOW - 30000, targetSeconds: 90, elapsed: 30 } } }),
    );
    useAppState.mockReturnValue(
      baseAppState({ restTimersByPerson: { 7: { startedAt: NOW - 30000, targetSeconds: 90 } } }),
    );

    renderShell();

    expect(startRestTimer).not.toHaveBeenCalled();
  });

  it('does nothing when nobody in the household is resting', () => {
    const startRestTimer = vi.fn();
    const setRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ startRestTimer }));
    useAppState.mockReturnValue(baseAppState({ setRestTimer, restTimersByPerson: {} }));

    renderShell();

    expect(startRestTimer).not.toHaveBeenCalled();
    expect(setRestTimer).not.toHaveBeenCalled();
  });
});
