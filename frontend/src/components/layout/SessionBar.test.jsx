import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionBar from './SessionBar';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { useSessionRecap } from '../../hooks/useSessionRecap';
import { endWorkout } from '../../api/sessions';
import { tryForceUpdate } from '../../lib/swUpdate';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));
// Mocked like useLiveSession above: the recap's own assembly (history + catalog + pending writes)
// is covered by useSessionRecap's sources, and its wording by utils/sessionRecap.test.js. What
// matters here is that whatever it reports reaches the modal and the toast.
vi.mock('../../hooks/useSessionRecap', () => ({ useSessionRecap: vi.fn() }));
vi.mock('../../hooks/useRestTimerPreference', () => ({ useRestTimerPreference: vi.fn() }));
vi.mock('../../api/sessions', () => ({ endWorkout: vi.fn().mockResolvedValue(), editSession: vi.fn() }));
vi.mock('../../lib/swUpdate', () => ({ tryForceUpdate: vi.fn() }));

function baseAppState(overrides = {}) {
  return {
    activePersonId: 7,
    editingSession: null,
    endRoutine: vi.fn(),
    backToPicker: vi.fn(),
    setRestTimer: vi.fn(),
    ...overrides,
  };
}

function baseUI(overrides = {}) {
  return { restTimers: {}, showToast: vi.fn(), clearRestTimer: vi.fn(), ...overrides };
}

const liveSession = { id: 55, startedAt: '2026-07-15T12:00:00Z' };

function restTimer(overrides = {}) {
  return { 7: { startedAt: 1, targetSeconds: 90, elapsed: 0, capped: false, ...overrides } };
}

// The rest slot has no visible "Rest" text -- Playwright's getByText is a case-insensitive
// substring and this bar is on screen on the Settings tab too, where it would collide with the
// "Rest timer" toggle. Meaning lives in the role="img" label instead, which is also the hook both
// test layers select it by.
function restReadout() {
  return screen.queryByRole('img', { name: /^Rest / });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppState.mockReturnValue(baseAppState());
  useUI.mockReturnValue(baseUI());
  useLiveSession.mockReturnValue({ session: liveSession, refetch: vi.fn() });
  useRestTimerPreference.mockReturnValue([true, vi.fn()]);
  useSessionRecap.mockReturnValue({ exerciseCount: 3, setCount: 12, startedAt: liveSession.startedAt });
});

afterEach(() => {
  document.documentElement.style.removeProperty('--bottom-bar-height');
});

describe('SessionBar visibility', () => {
  it('renders nothing when there is no live session', () => {
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the session and its start time for a real live session', () => {
    render(<SessionBar />);

    expect(screen.getByText(/Session in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End workout' })).toBeInTheDocument();
  });

  // While offline with no live session yet, ExerciseDetail's onMutate optimistically seeds a
  // PROVISIONAL session -- { id: null, startedAt: <clientLoggedAt> } -- into the same liveSession
  // cache useLiveSession reads. The bar gates on `session` TRUTHINESS, never `session.id`, which is
  // what makes it appear instantly (with an honest start time) in every connectivity mode rather
  // than waiting on a create-session round trip that may never complete.
  it('shows the bar for a provisional (id: null) offline live session', () => {
    useLiveSession.mockReturnValue({ session: { id: null, startedAt: '2026-07-22T09:00:00Z' }, refetch: vi.fn() });
    render(<SessionBar />);

    expect(screen.getByText(/Session in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End workout' })).toBeInTheDocument();
  });

  // Editing a past session is an editor, not a live session, and its own date/time card stays in
  // flow in LogTab. Mirrors the `!editingSession && liveSession` condition the banner this replaces
  // used, so the two can never both claim the screen.
  it('stays hidden while a past session is being edited', () => {
    useAppState.mockReturnValue(baseAppState({ editingSession: { id: 3, startedAt: 'x' } }));
    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('degrades to the label alone if a session somehow has no start time', () => {
    useLiveSession.mockReturnValue({ session: { id: 55 }, refetch: vi.fn() });
    render(<SessionBar />);

    // Never "started Invalid Date".
    expect(screen.getByText('Session in progress')).toBeInTheDocument();
  });
});

// The bar is position: fixed, so nothing reserves room for it automatically. Without this the bar
// covers the end of every tab -- above all the full-width "Log set" button. It is set on
// documentElement because one of the three consumers (ServiceWorkerUpdater) is mounted outside
// .app-shell and so inherits nothing from it.
describe('SessionBar reserved space', () => {
  it('reserves its height while mounted and releases it when the session ends', () => {
    const { rerender } = render(<SessionBar />);
    expect(document.documentElement.style.getPropertyValue('--bottom-bar-height')).toBe('var(--session-bar-height)');

    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    rerender(<SessionBar />);
    expect(document.documentElement.style.getPropertyValue('--bottom-bar-height')).toBe('');
  });

  it('reserves nothing when it never renders', () => {
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    render(<SessionBar />);

    expect(document.documentElement.style.getPropertyValue('--bottom-bar-height')).toBe('');
  });

  it('releases the reservation on unmount', () => {
    const { unmount } = render(<SessionBar />);
    unmount();

    expect(document.documentElement.style.getPropertyValue('--bottom-bar-height')).toBe('');
  });
});

describe('SessionBar rest readout', () => {
  it('shows nothing in the rest slot when no timer is running', () => {
    render(<SessionBar />);
    expect(restReadout()).toBeNull();
  });

  it('shows elapsed alone while under the target', () => {
    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 72 }) }));
    render(<SessionBar />);

    expect(restReadout()).toHaveAccessibleName('Rest 1:12');
    expect(screen.getByText('1:12')).toBeInTheDocument();
  });

  // Overrun is the number the old countdown destroyed by deleting itself at zero.
  it('adds the overage once past the target', () => {
    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 112 }) }));
    render(<SessionBar />);

    expect(restReadout()).toHaveAccessibleName('Rest 1:52, 0:22 past target');
    expect(screen.getByText('1:52')).toBeInTheDocument();
    // The minus sign carries the meaning; colour only reinforces it.
    expect(screen.getByText(/−0:22/)).toBeInTheDocument();
  });

  it('freezes both numbers at the ceiling instead of climbing forever', () => {
    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 600, capped: true }) }));
    render(<SessionBar />);

    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText(/−8:30/)).toBeInTheDocument();
  });

  it('fills the progress bar proportionally and stops at full', () => {
    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 45 }) }));
    const { container, rerender } = render(<SessionBar />);
    expect(container.querySelector('.session-bar-progress').style.width).toBe('50%');

    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 300 }) }));
    rerender(<SessionBar />);
    expect(container.querySelector('.session-bar-progress').style.width).toBe('100%');
  });

  // The preference suppresses the READOUT, not the session. Someone who has switched their rest
  // timer off still has a workout to end.
  it('hides the readout but keeps the bar when the rest timer preference is off', () => {
    useRestTimerPreference.mockReturnValue([false, vi.fn()]);
    useUI.mockReturnValue(baseUI({ restTimers: restTimer({ elapsed: 45 }) }));
    render(<SessionBar />);

    expect(restReadout()).toBeNull();
    expect(screen.getByText(/Session in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End workout' })).toBeInTheDocument();
  });

  // Per-person isolation: restTimers is keyed by personId, so someone else's running timer must
  // never surface on the active person's bar.
  it("never shows another person's rest timer", () => {
    useUI.mockReturnValue(baseUI({ restTimers: { 8: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false } } }));
    render(<SessionBar />);

    expect(restReadout()).toBeNull();
  });
});

describe('SessionBar end workout', () => {
  async function endTheWorkout() {
    // The bar's button and the confirm modal's share the label once the modal is open -- the
    // modal's is the one added last.
    fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'End workout' }).at(-1));
  }

  it("ends the workout, ends the routine, and returns to the person's picker", async () => {
    const appState = baseAppState();
    useAppState.mockReturnValue(appState);
    render(<SessionBar />);

    await endTheWorkout();

    await waitFor(() => expect(endWorkout).toHaveBeenCalledWith(7));
    expect(appState.endRoutine).toHaveBeenCalled();
    expect(appState.backToPicker).toHaveBeenCalled();
  });

  it("stops that person's rest timer, in memory AND on disk", async () => {
    const appState = baseAppState();
    useAppState.mockReturnValue(appState);
    const clearRestTimer = vi.fn();
    useUI.mockReturnValue(baseUI({ clearRestTimer, restTimers: restTimer({ elapsed: 30 }) }));
    render(<SessionBar />);

    await endTheWorkout();

    await waitFor(() => expect(endWorkout).toHaveBeenCalledWith(7));
    expect(clearRestTimer).toHaveBeenCalledWith(7);
    // Clearing only the in-memory copy leaves the persisted start for AppShell to resume on the
    // next mount -- a rest timer for a workout that is over.
    expect(appState.setRestTimer).toHaveBeenCalledWith({});
  });

  it('is a forced-reload trigger point', async () => {
    render(<SessionBar />);

    await endTheWorkout();

    await waitFor(() => expect(tryForceUpdate).toHaveBeenCalled());
    expect(tryForceUpdate.mock.calls[0][1]).toBe(7);
  });

  // Ending a workout used to report only a state transition ("Workout ended.") while the session's
  // own numbers sat unused in the cache. The confirm modal is where they are certain to be read; a
  // 3.2s toast after the fact is easy to miss with a phone already back in a pocket.
  it('shows what was actually done, in the modal and again in the toast', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue(baseUI({ showToast }));
    // Anchored to now, not to `liveSession`'s fixed date: the duration is measured against the real
    // clock, so a literal startedAt would render however long ago that date happens to be.
    const startedAt = new Date(Date.now() - 47 * 60 * 1000).toISOString();
    useSessionRecap.mockReturnValue({ exerciseCount: 3, setCount: 12, startedAt });
    render(<SessionBar />);

    fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
    expect(screen.getByText('3 exercises · 12 sets · 47 min')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'End workout' }).at(-1));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toBe('Workout ended — 3 exercises · 12 sets · 47 min.');
  });

  // A workout with nothing in it is real -- a mis-tap on "Log set" that was then deleted, or a
  // session someone else's set started on a shared device. Reporting "0 exercises · 0 sets" would
  // be worse than the plain sentence, so the recap suppresses itself and the caller falls back.
  it('falls back to the plain sentence when there is nothing to report', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue(baseUI({ showToast }));
    useSessionRecap.mockReturnValue({ exerciseCount: 0, setCount: 0, startedAt: liveSession.startedAt });
    render(<SessionBar />);

    fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
    expect(screen.queryByText(/exercises ·/)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'End workout' }).at(-1));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toBe('Workout ended. Logging a set anytime starts a new one.');
  });
});
