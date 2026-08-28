import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductTour from './ProductTour';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';

// Mocked per the AddPersonModal.test.jsx convention -- ProductTour never renders inside a real
// provider tree in this file, so nothing here can prove PIXEL placement (jsdom computes no
// layout; that's tourPosition.test.js's job) or that the real screens actually arrange
// (e2e/tests/onboarding-tour.spec.ts's job). What this file proves is the overlay's own
// contract: steps, controls, focus, and -- the one thing that must never regress silently -- the
// full restore on Escape/Skip tour.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/usePersonExercises', () => ({ usePersonExercises: vi.fn() }));

// react-router-dom is deliberately REAL here (a MemoryRouter), not mocked -- a mocked navigate()
// that doesn't actually move the router's location would make the pathname-restore assertions
// below pass or fail for the wrong reason (the arrange effect comparing against a location that
// never moved). This probe reads the one thing worth asserting on: where the router actually is.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

// A real, stateful stand-in for AppShell's `{tour && <ProductTour/>}` -- it owns the tour's
// runtime state the way UIContext really does, so clicking Continue/Previous/Skip tour inside
// ProductTour genuinely drives this harness's state (and, on endTour, genuinely unmounts
// ProductTour) rather than needing a hand-rolled pub/sub layer.
function Harness({ initialStepIndex = 0 }) {
  const [state, setState] = useState({ active: true, stepIndex: initialStepIndex });
  useUI.mockReturnValue({
    tour: state.active ? { stepIndex: state.stepIndex } : null,
    nextTourStep: () => setState((s) => ({ ...s, stepIndex: s.stepIndex + 1 })),
    prevTourStep: () => setState((s) => ({ ...s, stepIndex: Math.max(0, s.stepIndex - 1) })),
    endTour: () => setState((s) => ({ ...s, active: false })),
  });
  return state.active ? <ProductTour /> : null;
}

function baseAppState(overrides = {}) {
  return {
    activePersonId: 7,
    selectedExerciseId: null,
    exerciseSearch: '',
    weightDraft: null,
    repsDraft: 8,
    durationDraft: 30,
    draftExerciseId: null,
    draftSetCount: 0,
    draftSource: 'prefill',
    selectExercise: vi.fn(),
    backToPicker: vi.fn(),
    setExerciseSearch: vi.fn(),
    setDraft: vi.fn(),
    ...overrides,
  };
}

function renderTour({ initialPath = '/app/log', initialStepIndex = 0, appState = {} } = {}) {
  useAppState.mockReturnValue(baseAppState(appState));
  useExercises.mockReturnValue({ exercises: [] });
  usePersonExercises.mockReturnValue({ exercises: [] });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Harness initialStepIndex={initialStepIndex} />
    </MemoryRouter>,
  );
}

function pathname() {
  return screen.getByTestId('pathname').textContent;
}

function clickContinue() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProductTour steps and controls', () => {
  it('opens on step 1, with no Previous button', () => {
    renderTour();

    expect(screen.getByText('Step 1 of 9')).toBeInTheDocument();
    expect(screen.getByText('Everything starts on the Log tab')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });

  it('Continue advances to the next step', () => {
    renderTour();
    clickContinue();

    expect(screen.getByText('Step 2 of 9')).toBeInTheDocument();
    expect(screen.getByText('Everyone on one account')).toBeInTheDocument();
  });

  it('Previous steps back, and reappears once past step 1', () => {
    renderTour();
    clickContinue();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(screen.getByText('Step 1 of 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });

  it('reads "Got it" instead of "Continue" on step 9, the last step', () => {
    renderTour({ initialStepIndex: 8 });

    expect(screen.getByText('Step 9 of 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('"Got it" ends the tour, same as Skip tour', () => {
    renderTour({ initialStepIndex: 8 });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ProductTour focus management', () => {
  it('focuses the dialog on mount', () => {
    renderTour();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('focuses the (fresh) dialog again after Continue', () => {
    renderTour();
    const firstDialog = screen.getByRole('dialog');
    clickContinue();
    const secondDialog = screen.getByRole('dialog');

    expect(document.activeElement).toBe(secondDialog);
    expect(secondDialog).not.toBe(firstDialog);
  });
});

describe('ProductTour restore on exit', () => {
  // Mirrors the plan's e2e scenario: search "dead", have an exercise open, take the tour from
  // Help, step forward twice, then bail -- everything must land back exactly where it was.
  function snapshotAppState() {
    return {
      selectedExerciseId: 42,
      exerciseSearch: 'dead',
      weightDraft: 225,
      repsDraft: 3,
      durationDraft: 45,
      draftExerciseId: 42,
      draftSetCount: 2,
      draftSource: 'user',
      selectExercise: vi.fn(),
      backToPicker: vi.fn(),
      setExerciseSearch: vi.fn(),
      setDraft: vi.fn(),
    };
  }

  it('Skip tour restores the exercise, search, all six draft fields, and the pathname', () => {
    const appState = snapshotAppState();
    renderTour({ initialPath: '/app/help', appState });

    clickContinue();
    clickContinue();
    // Confirms the tour genuinely moved the app first -- restoring to where you already are
    // would make the pathname assertion below pass vacuously.
    expect(pathname()).toBe('/app/log');

    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(appState.selectExercise).toHaveBeenCalledWith(42);
    expect(appState.setExerciseSearch).toHaveBeenCalledWith('dead');
    expect(appState.setDraft).toHaveBeenCalledWith({
      exerciseId: 42,
      weight: 225,
      reps: 3,
      durationSeconds: 45,
      setCount: 2,
      source: 'user',
    });
    expect(pathname()).toBe('/app/help');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Verified non-vacuous: this is the exact case docs/incidents/2026-08-12-... exists for --
  // deleting the restore would leave 42 selected forever instead of putting the person back on
  // Help with their exercise, search and draft exactly as they left them.
  it('Escape performs the identical restore', () => {
    const appState = snapshotAppState();
    renderTour({ initialPath: '/app/help', appState });

    clickContinue();
    clickContinue();
    expect(pathname()).toBe('/app/log');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(appState.selectExercise).toHaveBeenCalledWith(42);
    expect(appState.setExerciseSearch).toHaveBeenCalledWith('dead');
    expect(appState.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 42, weight: 225, reps: 3, durationSeconds: 45, setCount: 2, source: 'user' }),
    );
    expect(pathname()).toBe('/app/help');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('backs to the picker instead of selecting an exercise when none was open to begin with', () => {
    const appState = snapshotAppState();
    appState.selectedExerciseId = null;
    renderTour({ initialPath: '/app/log', appState });

    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(appState.selectExercise).not.toHaveBeenCalled();
    expect(appState.backToPicker).toHaveBeenCalled();
  });
});

describe('ProductTour missing-anchor degrade', () => {
  beforeEach(() => vi.useFakeTimers());

  // None of the real screens are rendered in this file, so every anchor is permanently absent --
  // this proves the tour degrades honestly rather than parking on a dimmed screen forever.
  it('still renders the step, with working controls, once the 3s wait expires', () => {
    renderTour();
    expect(document.querySelector('[data-tour-anchor]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(screen.getByText('Step 1 of 9')).toBeInTheDocument();
    expect(screen.getByText('Everything starts on the Log tab')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 2 of 9')).toBeInTheDocument();
  });
});

describe('ProductTour placement bail-out', () => {
  // jsdom computes no layout, so the card's measured rect is always 0x0 here -- every render in
  // this file already exercises this path. This test only pins that it degrades silently rather
  // than throwing.
  it('does not throw when the card has a zero-size rect', () => {
    expect(() => renderTour()).not.toThrow();
  });
});
