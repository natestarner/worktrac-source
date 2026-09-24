import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { queryKeys } from '../../api/queryKeys';
import { markSessionEnded } from '../../lib/endedSessions';
import { registerOfflineMutationDefaults } from '../../lib/queryClient';
import ExerciseDetail from './ExerciseDetail';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { editSet, listSessionSets, logLiveSet, logSetIntoSession } from '../../api/sets';
import { getSessionExerciseNote, saveLiveExerciseNote, saveSessionExerciseNote } from '../../api/notes';
import { getHistory } from '../../api/sessions';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// ExerciseDetail's handleLogSet only starts the 90s rest timer for a LIVE set --
// never for a set logged while editing a past/retroactive session. This is the one
// behavior in the requirements that structurally needs a rendered component (it's about
// which context function fires from an event handler, not a pure calculation), so this
// is the sole RTL component test in the suite for this pass; the surrounding hooks are
// mocked out rather than rendering the real providers.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/stats', () => ({ getExerciseSummary: vi.fn() }));
vi.mock('../../api/sets', () => ({
  listSessionSets: vi.fn(),
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  deleteSet: vi.fn(),
  editSet: vi.fn(),
}));
vi.mock('../../api/exercises', () => ({
  listCustomFields: vi.fn().mockResolvedValue([]),
  addCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  setExerciseTags: vi.fn(),
  updateExercise: vi.fn(),
  removeExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  unfavoriteExercise: vi.fn(),
}));
vi.mock('../../api/notes', () => ({
  getSessionExerciseNote: vi.fn(),
  saveLiveExerciseNote: vi.fn(),
  saveSessionExerciseNote: vi.fn(),
}));
// Backs the offline/lie-fi fallback's useHistory() read -- defaults to empty so every existing
// test in this file (which doesn't care about history) is unaffected; the fallback tests below
// override this per-case.
vi.mock('../../api/sessions', () => ({
  getHistory: vi.fn().mockResolvedValue([]),
}));
// ...and RESTORED before every test, because vi.clearAllMocks() keeps a mocked return value. Two
// describes below set a Bench Press history and never put the default back, so it leaked into every
// later test -- including the plank tests, which reuse exercise id 1. That was invisible while the
// Best card ignored history online; since #326 it reads history too, and a leaked weighted set is a
// stronger "best" than any hold. A describe that wants a history still sets one in its own
// beforeEach, which runs after this.
beforeEach(() => {
  getHistory.mockResolvedValue([]);
});
const exercise = { id: 1, name: 'Bench Press', tags: [], isFavorite: true, setupFields: [] };

// "Typed more recently than anything currently on screen." ExerciseDetail only re-seeds the draft
// once the set count has INCREASED past the stamp, so a count nothing can exceed keeps a seeded
// draft owned for a whole test. That is exactly what these cases mean: the person typed this
// weight, and it must survive the prefill re-seed rather than being replaced by last session's.
const TYPED_AFTER_EVERYTHING = Number.MAX_SAFE_INTEGER;

// The slice as it looks when the person has typed a weight/reps for this exercise. Most tests below
// seed a fixed draft and expect the component to log exactly that; without the stamp saying who it
// belongs to, ExerciseDetail correctly ignores it and derives the prefill instead.
function typedDraft({ weight = 135, reps = 8, exerciseId = exercise.id } = {}) {
  return {
    weightDraft: weight,
    repsDraft: reps,
    draftExerciseId: exerciseId,
    draftSetCount: TYPED_AFTER_EVERYTHING,
    draftSource: 'user',
    setDraft: vi.fn(),
    setHoldStartedAt: vi.fn(),
    setRestTimer: vi.fn(),
    // The session-volume celebration's churn backstop. Empty means "nothing celebrated yet",
    // which is the state every one of these tests starts a workout in.
    volumePrCelebrated: {},
    recordVolumePrCelebrated: vi.fn(),
    // Called on every set edit and delete, because either can LOWER the all-time session-volume
    // record and leave this latch suppressing every genuine new one below it. Omitting it here
    // does not fail a test -- it throws out of an event handler, which Vitest reports as an
    // unhandled `Errors 1` beside a green `Tests` line, and CI fails on it while a casual read of
    // the summary does not.
    clearVolumePrCelebrated: vi.fn(),
  };
}

function renderExerciseDetail(props = {}) {
  return renderWithQuery(
    <ExerciseDetail
      exercise={exercise}
      personId={7}
      editingSessionId={null}
      liveSession={null}
      refetchLiveSession={vi.fn().mockResolvedValue()}
      onBack={vi.fn()}
      {...props}
    />,
  );
}

describe('ExerciseDetail rest-timer live-vs-retroactive gating', () => {
  let startRestTimer;

  beforeEach(() => {
    vi.clearAllMocks();
    startRestTimer = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer, openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    logSetIntoSession.mockResolvedValue({ isPR: false, best: null, session: { id: 102 }, set: { id: 202 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the rest timer when logging a live set', async () => {
    renderExerciseDetail({ editingSessionId: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    // (personId, targetSeconds, startedAt). The target is SNAPSHOTTED at the tap rather than
    // re-derived later from whatever exercise is on screen, and startedAt is passed explicitly so
    // the same call shape can resume a timer after a reload.
    expect(startRestTimer).toHaveBeenCalledWith(7, 90, expect.any(Number));
  });

  it('does not start the rest timer when logging a set while editing a past session', async () => {
    renderExerciseDetail({ editingSessionId: 55 });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(logSetIntoSession).toHaveBeenCalledWith(55, expect.objectContaining({ exerciseId: 1, weight: 135, reps: 8 })),
    );
    expect(startRestTimer).not.toHaveBeenCalled();
  });
});

// Cheap and high-value: stops a refactor silently deleting an attribute nothing else in this file
// references. All three anchors render unconditionally (not gated on `ready`), so no async wait
// is needed here.
describe('ExerciseDetail tour anchors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  it('anchors the stepper pair, the Log-set button and the Customize button', () => {
    const { container } = renderExerciseDetail();

    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.SET_ENTRY}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.LOG_SET}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.CUSTOMIZE_EXERCISE}"]`)).not.toBeNull();
  });
});

// The celebration payload is now decided AT DISPATCH, from bests the client already holds -- not
// from the log-set response. That is what makes it fire in every connectivity mode; see
// prDetection.js. These tests therefore stub getExerciseSummary (the prior bests) rather than
// logLiveSet's response, and assert the { exerciseName, prs: [...], firstTime } shape.
//
// A bodyweight set (weight === 0) makes Epley's 1RM estimate meaningless -- it collapses to 0
// regardless of reps -- so the payload surfaces the rep count instead. Mirrors the same weight-0
// convention as comparableLb in utils/formulas.js.
describe('ExerciseDetail PR celebration payload', () => {
  let showCelebration;

  // Finds the row for one measure inside the single overlay payload.
  function rowFor(type) {
    const payload = showCelebration.mock.calls.at(-1)?.[0];
    return payload?.prs?.find((pr) => pr.type === type);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    showCelebration = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    useUI.mockReturnValue({ showCelebration, showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the rep count instead of a weight/1RM calc for a bodyweight PR', async () => {
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(rowFor('est1rm')).toMatchObject({ caption: 'Bodyweight', valueText: '12 reps' });
    // ⚠️ A bodyweight set weighs 0, and 0 is not a top-weight record.
    expect(rowFor('heaviest')).toBeUndefined();
  });

  it('shows the normal weight/1RM calc for a weighted PR', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 185, reps: 5 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    // 185 x (1 + 5/30) = 215.83 -> 215.8. Five reps is under the 12-rep cap, so it does not apply.
    // The caption is the SET behind the estimate, not a repeat of the measure name -- the badge
    // beside the number already says "Est. 1RM".
    expect(rowFor('est1rm')).toMatchObject({ caption: '185 lb × 5', valueText: '215.8 lb' });
  });

  // THE REGRESSION, reported from the app: create a timed exercise, put a weight AND a time on it,
  // log it, and the PR overlay called it "Bodyweight".
  //
  // The cause was one flag answering two questions. `isBodyweight: isBodyweight || isHold` is
  // correct for "does this set have an est. 1RM to show" and wrong for "was this performed at
  // bodyweight", and PRCelebration rendered it as the literal word. PRsTab has always split those
  // correctly ("Longest hold at 25lb"), so the two surfaces disagreed about the same set.
  it('names the load on a weighted hold rather than calling it bodyweight', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 25, reps: 0 }));
    renderExerciseDetail({ exercise: { ...exercise, trackingType: 'duration' } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(rowFor('est1rm').caption).toBe('Weighted · 25 lb');
    expect(rowFor('est1rm').caption).not.toBe('Bodyweight');
  });

  // The half that was never wrong: an unweighted hold really is a bodyweight hold.
  it('still calls an unweighted hold bodyweight', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 0 }));
    renderExerciseDetail({ exercise: { ...exercise, trackingType: 'duration' } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(rowFor('est1rm').caption).toBe('Bodyweight');
  });

  // The three-way naming, asserted on the payload so it cannot drift from History's badge (both
  // read est1rmLabelForSet). "Est. 1RM" on a pull-up or a plank is the costume problem.
  it('names a bodyweight record by its reps', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(rowFor('est1rm').label).toBe('Most reps');
  });

  it('names a hold record by its duration, weighted or not', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 25, reps: 0 }));
    renderExerciseDetail({ exercise: { ...exercise, trackingType: 'duration' } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(rowFor('est1rm').label).toBe('Longest hold');
    // A weighted hold ALSO takes the top-weight record: reps are 0 so volume cannot fire, but the
    // load is real. This is the combination case that produced the old "every hold is Bodyweight"
    // bug one layer up.
    expect(rowFor('heaviest')).toMatchObject({ caption: 'Heaviest load held' });
  });

  // ⚠️ Neither weight-derived record may fire for a bodyweight lift: weight 0 means top weight
  // and volume are both 0, and 0 is not a record. Without this they would fire on every set.
  it('celebrates a bodyweight set on reps alone, never on weight or volume', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(showCelebration.mock.calls.at(-1)[0].prs.map((pr) => pr.type)).toEqual(['est1rm']);
  });

  it('celebrates an unloaded hold on time alone', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 0 }));
    renderExerciseDetail({ exercise: { ...exercise, trackingType: 'duration' } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(showCelebration.mock.calls.at(-1)[0].prs.map((pr) => pr.type)).toEqual(['est1rm']);
  });

  it('marks a first-ever set as a baseline rather than claiming a stack of records', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 185, reps: 5 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    expect(showCelebration.mock.calls.at(-1)[0].firstTime).toBe(true);
  });

  // The first workout of an exercise is trivially its biggest, so a volume record there says
  // nothing. The set records still show (with the "first time" framing) -- only volume waits for a
  // second workout to have something to beat. Asserted against BOTH summary shapes: the current
  // one, and the pre-volumeKind one a cached summary may still hold.
  it.each([
    ['current', { lastSession: null, best: null, heaviestWeightLb: null, bestSessionVolume: null, volumeKind: null }],
    ['legacy', { lastSession: null, best: null, heaviestWeightLb: null, bestSessionVolumeLb: null }],
  ])('never celebrates volume on a first-ever set (%s summary)', async (_, summary) => {
    getExerciseSummary.mockResolvedValue(summary);
    useAppState.mockReturnValue(typedDraft({ weight: 185, reps: 5 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    const payload = showCelebration.mock.calls.at(-1)[0];
    expect(payload.firstTime).toBe(true);
    expect(payload.prs.map((pr) => pr.type)).toEqual(['heaviest', 'est1rm']);
  });

  // Waits for the summary to land: `ready` lets "Log set" render while it is in flight, and
  // clicking then races it into a first-ever set.
  async function logOnceSummaryLands() {
    await waitFor(() => expect(screen.queryByText('No PR yet')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
  }

  it('measures a bodyweight exercise’s volume in total reps', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 15, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolume: 10,
      volumeKind: 'reps',
    });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    renderExerciseDetail();

    await logOnceSummaryLands();

    // 12 reps beats the best earlier session's 10. The set itself beats nothing (15 is the best).
    expect(showCelebration).toHaveBeenCalledTimes(1);
    expect(showCelebration.mock.calls.at(-1)[0].prs.map((pr) => pr.type)).toEqual(['sessionVolume']);
    expect(rowFor('sessionVolume')).toMatchObject({ valueText: '12 reps', caption: '1 set this workout' });
  });

  it('measures a hold’s volume in total time', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 0, durationSeconds: 90, unit: 'lb', est1rm: null },
      heaviestWeightLb: 0,
      bestSessionVolume: 50,
      volumeKind: 'seconds',
    });
    useAppState.mockReturnValue({ ...typedDraft({ weight: 0, reps: 0 }), durationDraft: 60 });
    renderExerciseDetail({ exercise: { ...exercise, trackingType: 'duration' } });

    await logOnceSummaryLands();

    expect(showCelebration.mock.calls.at(-1)[0].prs.map((pr) => pr.type)).toEqual(['sessionVolume']);
    expect(rowFor('sessionVolume').valueText).toBe('1:00');
  });

  it('does not celebrate a bodyweight session that falls short of the best', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 15, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolume: 40,
      volumeKind: 'reps',
    });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    renderExerciseDetail();

    await logOnceSummaryLands();

    expect(showCelebration).not.toHaveBeenCalled();
  });

  // The kind is merged across synced history and today's set: the first loaded pull-up turns the
  // exercise into pounds, every earlier session is then 0 lb, and this workout takes the record.
  it('switches a bodyweight exercise to pounds the first time it is loaded', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 15, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolume: 40,
      volumeKind: 'reps',
    });
    useAppState.mockReturnValue(typedDraft({ weight: 10, reps: 5 }));
    renderExerciseDetail();

    await logOnceSummaryLands();

    expect(rowFor('sessionVolume')).toMatchObject({ valueText: '50 lb' });
  });

  // The churn backstop is kind-aware: a latch of 40 REPS from the exercise's bodyweight days must
  // not suppress a 50 LB record once it is loaded. A bare number is a pre-kinds latch, i.e. pounds.
  it.each([
    ['a reps latch', { kind: 'reps', value: 400 }, true],
    ['a pounds latch above it', { kind: 'load', value: 400 }, false],
    ['a legacy bare-number latch above it', 400, false],
  ])('reads %s in its own kind', async (_, latch, fires) => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 15, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolume: 40,
      volumeKind: 'reps',
    });
    useAppState.mockReturnValue({ ...typedDraft({ weight: 10, reps: 5 }), volumePrCelebrated: { [exercise.id]: latch } });
    renderExerciseDetail();

    await logOnceSummaryLands();

    expect(Boolean(rowFor('sessionVolume'))).toBe(fires);
  });

  it('reports both set records in ONE payload when a set takes both', async () => {
    // A prior best well below what is about to be logged, so this is a genuine PR rather than a
    // first-ever set.
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 100, reps: 5, unit: 'lb', est1rm: 116.7 },
      heaviestWeightLb: 100,
      bestSessionVolumeLb: 100000,
    });
    useAppState.mockReturnValue(typedDraft({ weight: 185, reps: 5 }));
    renderExerciseDetail();

    // Wait for the prior best to actually land: `ready` lets "Log set" render while the summary
    // query is still in flight, so clicking immediately races it and the set reads as first-ever.
    await screen.findByText(/100lb×5/);
    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showCelebration).toHaveBeenCalled());
    const payload = showCelebration.mock.calls.at(-1)[0];
    expect(showCelebration).toHaveBeenCalledTimes(1);
    expect(payload.firstTime).toBe(false);
    // Fixed precedence order, so a given combination always reads the same way round.
    expect(payload.prs.map((pr) => pr.type)).toEqual(['heaviest', 'est1rm']);
  });

  it('does not celebrate a set that beats nothing', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 500, reps: 5, unit: 'lb', est1rm: 583.3 },
      heaviestWeightLb: 500,
      bestSessionVolumeLb: 100000,
    });
    useAppState.mockReturnValue(typedDraft({ weight: 100, reps: 5 }));
    renderExerciseDetail();

    // Same race as above: without this the summary has not landed, the set looks first-ever, and
    // the assertion below passes or fails on timing rather than on the rule it is testing.
    await screen.findByText(/500lb×5/);
    fireEvent.click(await screen.findByText('Log set'));

    // The set still logs -- that is the part that matters.
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(showCelebration).not.toHaveBeenCalled();
  });

  // ⚠️ A celebration must never be able to stop a set being logged. The block is wrapped for
  // exactly this: decoration over a write that has not been dispatched yet.
  it('still logs the set when raising the celebration throws', async () => {
    showCelebration.mockImplementation(() => {
      throw new Error('boom');
    });
    useAppState.mockReturnValue(typedDraft({ weight: 185, reps: 5 }));
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
  });
});

// #326: the summary the record check reads is keyed on "no live session", fetched BEFORE a workout
// and never refreshed when that workout ends. So on the next visit it can be a workout (or several)
// out of date while its refetch is in flight -- online for a round trip, in lie-fi for the whole
// retry run. `history` is refreshed after every set, so the priors are the stronger of the two.
//
// Every test here waits for BOTH queries to have landed before tapping, rather than for UI text:
// what the cards show differs between the unfixed and fixed code, so a text wait would make the
// "before" run measure a different moment from the "after" run.
describe('ExerciseDetail record priors: an out-of-date summary and history (#326)', () => {
  let showCelebration;

  const bw = (reps) => ({ weight: 0, reps, durationSeconds: null, unit: 'lb' });
  const workout = (id, startedAt, sets) => ({
    id,
    startedAt,
    endedAt: startedAt,
    manual: false,
    entries: [{ exerciseId: exercise.id, exerciseName: exercise.name, sets, note: null }],
  });
  const EMPTY_SUMMARY = { lastSession: null, best: null, heaviestWeightLb: null, bestSessionVolume: null, volumeKind: null };

  async function tapOnceBothLand(queryClient, historyStatus = 'success') {
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.exerciseSummary(7, exercise.id, null))?.status).toBe('success');
      expect(queryClient.getQueryState(queryKeys.history(7))?.status).toBe(historyStatus);
    });
    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
  }

  const prTypes = () => showCelebration.mock.calls.at(-1)?.[0]?.prs?.map((pr) => pr.type);

  beforeEach(() => {
    vi.clearAllMocks();
    showCelebration = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useUI.mockReturnValue({ showCelebration, showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
  });

  afterEach(() => vi.clearAllMocks());

  // The false "first time" record: 10 reps last workout, and a summary from before it.
  it('does not celebrate a first-ever record when only the summary is out of date', async () => {
    getExerciseSummary.mockResolvedValue(EMPTY_SUMMARY);
    getHistory.mockResolvedValue([workout(1, '2026-09-20T12:00:00Z', [bw(10)])]);
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 6 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient);

    expect(showCelebration).not.toHaveBeenCalled();
  });

  // The realistic one, and not about "first time" at all: 12 reps last workout, a summary that still
  // says 10, and 11 today. The same inputs also pin the ACCEPTED COST of this fix: had the summary
  // been the fresh one (the 12 since edited down or deleted) and history the stale one, 11 would be a
  // genuine record that goes uncelebrated until history refetches. The client cannot tell which
  // source is stale, and a missed celebration is the cheaper mistake. See .claude/rules/log-screen.md.
  it('does not celebrate against a best that is one workout out of date', async () => {
    getExerciseSummary.mockResolvedValue({ ...EMPTY_SUMMARY, best: { ...bw(10), est1rm: 0 }, heaviestWeightLb: 0, bestSessionVolume: 10, volumeKind: 'reps' });
    getHistory.mockResolvedValue([workout(2, '2026-09-22T12:00:00Z', [bw(12)]), workout(1, '2026-09-20T12:00:00Z', [bw(10)])]);
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 11 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient);

    expect(showCelebration).not.toHaveBeenCalled();
  });

  it('measures the volume record against history when the summary predates the only earlier workout', async () => {
    getExerciseSummary.mockResolvedValue(EMPTY_SUMMARY);
    getHistory.mockResolvedValue([workout(1, '2026-09-20T12:00:00Z', [bw(10)])]);
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient);

    // A real record on reps AND on the session's volume -- not a "first time" baseline, which would
    // have claimed no volume record at all.
    expect(showCelebration).toHaveBeenCalledTimes(1);
    expect(showCelebration.mock.calls.at(-1)[0].firstTime).toBe(false);
    expect(prTypes()).toEqual(['est1rm', 'sessionVolume']);
  });

  it('still celebrates a genuine record over both sources, as a record rather than a first time', async () => {
    getExerciseSummary.mockResolvedValue({ ...EMPTY_SUMMARY, best: { ...bw(10), est1rm: 0 }, heaviestWeightLb: 0, bestSessionVolume: 10, volumeKind: 'reps' });
    getHistory.mockResolvedValue([workout(2, '2026-09-22T12:00:00Z', [bw(12)]), workout(1, '2026-09-20T12:00:00Z', [bw(10)])]);
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 13 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient);

    expect(showCelebration).toHaveBeenCalledTimes(1);
    expect(showCelebration.mock.calls.at(-1)[0].firstTime).toBe(false);
    expect(prTypes()).toContain('est1rm');
  });

  // ⚠️ The Free-tier guard, end to end. For a Free household `history` is window-clamped and the
  // summary is not, so an all-time best from outside the window is known ONLY to the summary. Taking
  // the stronger of the two keeps it: a set between the window's best and the all-time best is not
  // a record, and must not be celebrated as one.
  it('keeps a summary best that a window-clamped history cannot see', async () => {
    getExerciseSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      best: { weight: 225, reps: 5, unit: 'lb', est1rm: 262.5 },
      heaviestWeightLb: 225,
      bestSessionVolume: 1125,
      volumeKind: 'load',
    });
    getHistory.mockResolvedValue([workout(1, '2026-09-20T12:00:00Z', [{ weight: 185, reps: 5, durationSeconds: null, unit: 'lb' }])]);
    useAppState.mockReturnValue(typedDraft({ weight: 200, reps: 5 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient);

    expect(showCelebration).not.toHaveBeenCalled();
  });

  // A history that failed to load (or is empty) must leave the summary's answer exactly as it was.
  it.each([
    ['fails to load', () => getHistory.mockRejectedValue(new Error('history down')), 'error'],
    ['is empty', () => getHistory.mockResolvedValue([]), 'success'],
    ['has no sessions for this exercise', () => getHistory.mockResolvedValue([{ ...workout(1, '2026-09-20T12:00:00Z', []), entries: [] }]), 'success'],
  ])('falls back to the summary alone when history %s', async (_, arrange, historyStatus) => {
    arrange();
    getExerciseSummary.mockResolvedValue({ ...EMPTY_SUMMARY, best: { ...bw(10), est1rm: 0 }, heaviestWeightLb: 0, bestSessionVolume: 10, volumeKind: 'reps' });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 11 }));
    const { queryClient } = renderExerciseDetail();

    await tapOnceBothLand(queryClient, historyStatus);

    // 11 beats the summary's 10 on reps and on volume; nothing else is known, so both are records.
    expect(prTypes()).toEqual(['est1rm', 'sessionVolume']);
    expect(showCelebration.mock.calls.at(-1)[0].firstTime).toBe(false);
  });

  // The Best card and the "N more reps" hint read the same fold, so they cannot promise a record the
  // celebration then refuses.
  it('points the close-to-a-PR hint at the stronger best', async () => {
    getExerciseSummary.mockResolvedValue({ ...EMPTY_SUMMARY, best: { ...bw(10), est1rm: 0 }, heaviestWeightLb: 0, bestSessionVolume: 10, volumeKind: 'reps' });
    getHistory.mockResolvedValue([workout(2, '2026-09-22T12:00:00Z', [bw(12)]), workout(1, '2026-09-20T12:00:00Z', [bw(10)])]);
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 11 }));
    renderExerciseDetail();

    expect(await screen.findByText('2 more reps for a Most reps PR')).toBeInTheDocument();
  });
});

// The nudge under the steppers. Derived during render from effectiveBest, which already folds in
// sets that have not synced -- so it works in every connectivity mode by one code path.
describe('ExerciseDetail close-to-a-PR hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useUI.mockReturnValue({
      showCelebration: vi.fn(),
      showToast: vi.fn(),
      startRestTimer: vi.fn(),
      openConfirm: vi.fn(),
    });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
  });

  afterEach(() => vi.clearAllMocks());

  // Best is 135x10 -> 135 * (1 + 10/30) = 180. At 135 lb that needs 11 reps to beat, so a draft
  // of 9 is two away.
  function bestOf135x10() {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 135, reps: 10, unit: 'lb', est1rm: 180 },
      heaviestWeightLb: 135,
      bestSessionVolumeLb: 100000,
    });
  }

  it('names how many more reps would take the record', async () => {
    bestOf135x10();
    useAppState.mockReturnValue(typedDraft({ weight: 135, reps: 9 }));
    renderExerciseDetail();

    expect(await screen.findByText('2 more reps for an Est. 1RM PR')).toBeInTheDocument();
  });

  it('singularizes at one rep', async () => {
    bestOf135x10();
    useAppState.mockReturnValue(typedDraft({ weight: 135, reps: 10 }));
    renderExerciseDetail();

    expect(await screen.findByText('1 more rep for an Est. 1RM PR')).toBeInTheDocument();
  });

  // ⚠️ The hint NAMES the record, and the name is not always "Est. 1RM": the measure behind it is
  // comparableValue, which substitutes a rep count at weight 0 and seconds for a hold. Naming it
  // "Est. 1RM" on a pull-up is the "rep count wearing a costume" mistake .claude/rules/trends.md
  // exists to prevent. The other two shapes are covered below and in the duration suite.
  it('takes the article from the record name rather than hardcoding one', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolumeLb: null,
    });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 11 }));
    renderExerciseDetail();

    // "a Most reps", not "an Most reps" -- and correspondingly "an Est. 1RM" above.
    expect(await screen.findByText('2 more reps for a Most reps PR')).toBeInTheDocument();
  });

  // ⚠️ Silence is the right answer far more often than a number is. Without the bound this would
  // sit on screen through every warm-up set of every exercise, reading as "you are nowhere near".
  it('stays quiet when the record is out of reach', async () => {
    bestOf135x10();
    useAppState.mockReturnValue(typedDraft({ weight: 95, reps: 5 }));
    renderExerciseDetail();

    await screen.findByText('Log set');
    // Covers both shapes the hint can take -- a countdown and the arrived message.
    expect(screen.queryByText(/PR/)).not.toBeInTheDocument();
  });

  // ⚠️ THIS IS THE BUG THE HINT SHIPPED WITH, and the assertion is deliberately the opposite of
  // what it used to be. The rep search starts at gap = 1 and never tested the CURRENT numbers, so
  // once the draft already beat the record it still reported "1 more rep for a PR": the count
  // never reached zero, and no number of extra reps ever made it say so. It read as broken
  // because it was. The duration branch always had this guard; the rep branch did not.
  //
  // Note the old test passed against the bug: it queried /for a PR/, which "1 more rep for a PR"
  // matches -- so it asserted silence while the screen said something wrong.
  it('says the draft would take the record once it already beats it', async () => {
    bestOf135x10();
    useAppState.mockReturnValue(typedDraft({ weight: 225, reps: 5 }));
    renderExerciseDetail();

    expect(await screen.findByText('This would be an Est. 1RM PR')).toBeInTheDocument();
    expect(screen.queryByText(/more rep/)).not.toBeInTheDocument();
  });

  // The boundary itself: exactly tying the record is not beating it, so the countdown still shows.
  it('still counts down when the draft exactly ties the record', async () => {
    bestOf135x10();
    useAppState.mockReturnValue(typedDraft({ weight: 135, reps: 10 }));
    renderExerciseDetail();

    expect(await screen.findByText('1 more rep for an Est. 1RM PR')).toBeInTheDocument();
    expect(screen.queryByText(/This would be/)).not.toBeInTheDocument();
  });

  it('stays quiet when there is no record to beat yet', async () => {
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    useAppState.mockReturnValue(typedDraft({ weight: 135, reps: 8 }));
    renderExerciseDetail();

    await screen.findByText('Log set');
    // Covers both shapes the hint can take -- a countdown and the arrived message.
    expect(screen.queryByText(/PR/)).not.toBeInTheDocument();
  });

  // ⚠️ Past the 12-rep cap the estimate stops rising, so for a heavy enough record NO number of
  // reps at this weight can take it. A closed-form solve would happily report one anyway. The
  // forward search finds nothing and stays silent, which is the truth.
  it('stays quiet when the rep cap puts the record out of reach at this weight', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      // 300 lb est. 1RM. At 135 lb the capped ceiling is 135 * (1 + 12/30) = 189, so it is
      // unreachable however many reps are added.
      best: { weight: 250, reps: 6, unit: 'lb', est1rm: 300 },
      heaviestWeightLb: 250,
      bestSessionVolumeLb: 100000,
    });
    useAppState.mockReturnValue(typedDraft({ weight: 135, reps: 11 }));
    renderExerciseDetail();

    await screen.findByText('Log set');
    // Covers both shapes the hint can take -- a countdown and the arrived message.
    expect(screen.queryByText(/PR/)).not.toBeInTheDocument();
  });

  // At weight 0 the comparable IS the rep count, so the arithmetic that divides by weight would
  // blow up -- the target is simply one more rep than the best.
  it('counts reps directly for a bodyweight exercise', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0 },
      heaviestWeightLb: 0,
      bestSessionVolumeLb: null,
    });
    useAppState.mockReturnValue(typedDraft({ weight: 0, reps: 12 }));
    renderExerciseDetail();

    expect(await screen.findByText('1 more rep for a Most reps PR')).toBeInTheDocument();
  });
});

// The session note glyph must be ghosted with no callout when the current session has no
// note, and filled with a readable callout once one exists -- see ExerciseDetail.jsx's
// sessionNote state and the pinnedNoteStyle/sessionNoteStyle callouts. Saving before any
// set is logged still must go through the live-note endpoint (mirrors handleLogSet).
describe('ExerciseDetail exercise notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a ghosted glyph and no callout when the session has no note', async () => {
    getSessionExerciseNote.mockResolvedValue(null);
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByRole('button', { name: 'Add a note for this session' })).toBeInTheDocument();
    expect(screen.queryByText('Shoulder felt off today')).not.toBeInTheDocument();
  });

  it('shows a filled glyph and a callout once the session has a note', async () => {
    getSessionExerciseNote.mockResolvedValue({ sessionId: 101, exerciseId: 1, note: 'Shoulder felt off today' });
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByRole('button', { name: 'Edit note for this session' })).toBeInTheDocument();
    expect(screen.getByText('Shoulder felt off today')).toBeInTheDocument();
  });

  it('surfaces the previous session note in the Last time card', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: { sessionId: 55, startedAt: '2026-07-01T12:00:00Z', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: 'Felt strong' },
      best: null,
    });
    getSessionExerciseNote.mockResolvedValue(null);
    renderExerciseDetail();

    expect(await screen.findByText('Felt strong')).toBeInTheDocument();
  });

  it('saves a note before any set is logged through the live-note endpoint', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
    saveLiveExerciseNote.mockResolvedValue({ sessionId: 101, exerciseId: 1, note: 'Cut it short' });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByRole('button', { name: 'Add a note for this session' }));
    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'Cut it short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveLiveExerciseNote).toHaveBeenCalledWith(7, { exerciseId: 1, note: 'Cut it short' }));
    expect(showToast).toHaveBeenCalledWith('Note saved');
    expect(saveSessionExerciseNote).not.toHaveBeenCalled();
  });

  it('saves through the explicit-session endpoint when editing a past session', async () => {
    getSessionExerciseNote.mockResolvedValue(null);
    saveSessionExerciseNote.mockResolvedValue({ sessionId: 55, exerciseId: 1, note: 'Backfilled note' });
    renderExerciseDetail({ editingSessionId: 55, liveSession: null });

    fireEvent.click(await screen.findByRole('button', { name: 'Add a note for this session' }));
    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'Backfilled note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSessionExerciseNote).toHaveBeenCalledWith(55, 1, 'Backfilled note'));
    expect(saveLiveExerciseNote).not.toHaveBeenCalled();
  });

  // Regression test: a note saved while contextSessionId is null (no session has synced yet --
  // true before the first set of a brand-new workout, and for the rest of an offline/lie-fi
  // stretch even after one, since the placeholder liveSession seeded by logSetMutation.onMutate
  // is deliberately `{ id: null }`) used to be invisible until the write actually reached the
  // server and SAVE_NOTE's onSettled invalidation refetched -- impossible while paused offline.
  // See pendingLiveNote in ExerciseDetail.jsx, which mirrors pendingBeforeSession's technique for
  // sets: read the pending mutation's own variables straight from the shared MutationCache.
  it('shows a note saved before any session exists while paused offline, not just after reconnect', async () => {
    getSessionExerciseNote.mockResolvedValue(null);
    let resolveSave;
    saveLiveExerciseNote.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Add a note for this session' }));
      fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'Cut it short' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      // TanStack pauses the mutation before ever invoking mutationFn while offline -- the note
      // must still render from the pending mutation's variables, not from a completed request.
      expect(saveLiveExerciseNote).not.toHaveBeenCalled();
      // Wait for the modal to close (handleSave's onSave-then-onClose chain) before querying by
      // text -- while it's still open, the modal's own <textarea> also contains "Cut it short",
      // which would collide with the callout's text.
      await waitFor(() => expect(screen.queryByPlaceholderText('Write a note...')).not.toBeInTheDocument());
      expect(await screen.findByRole('button', { name: 'Edit note for this session' })).toBeInTheDocument();
      expect(screen.getByText('Cut it short')).toBeInTheDocument();

      onlineManager.setOnline(true);
      await waitFor(() => expect(saveLiveExerciseNote).toHaveBeenCalledWith(7, { exerciseId: 1, note: 'Cut it short' }));
      resolveSave({ sessionId: 101, exerciseId: 1, note: 'Cut it short' });
      // Still visible once the write actually settles too.
      expect(await screen.findByText('Cut it short')).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

// The summary/sets/etc. are keyed on personId (and the component is remounted via key={personId}
// at the LogTab call site), so switching people can never surface the previous person's numbers.
describe('ExerciseDetail per-person isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    // Each person's summary is distinct; the mock answers by personId.
    getExerciseSummary.mockImplementation((pid) =>
      Promise.resolve({
        lastSession: { startedAt: '2026-07-01T12:00:00Z', sets: [{ weight: pid === 7 ? 100 : 250, reps: 5, unit: 'lb' }] },
        best: null,
      }),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it("shows the active person's last-time card, never the previous person's, on switch", async () => {
    function Harness() {
      const [pid, setPid] = useState(7);
      return (
        <div>
          <button onClick={() => setPid(8)}>switch</button>
          <ExerciseDetail
            key={pid}
            exercise={exercise}
            personId={pid}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </div>
      );
    }
    renderWithQuery(<Harness />);

    expect(await screen.findByText('100lb×5')).toBeInTheDocument();

    fireEvent.click(screen.getByText('switch'));

    expect(await screen.findByText('250lb×5')).toBeInTheDocument();
    expect(screen.queryByText('100lb×5')).not.toBeInTheDocument();
  });
});

// The old handleLogSet had no error handling: a failed write was silent. Now a failure surfaces a
// message (and rolls back the optimistic set), so a logged set is never silently lost.
describe('ExerciseDetail write-failure handling', () => {
  let showToast;

  beforeEach(() => {
    vi.clearAllMocks();
    showToast = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('surfaces a message when a set fails to save (no more silent failures)', async () => {
    const clientError = Object.assign(new Error('Weight required'), { status: 400 });
    logLiveSet.mockRejectedValue(clientError);
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Weight required', { tone: 'error' }));
  });
});

// A tap that doesn't visibly acknowledge itself invites a second tap and reads as broken --
// each of these controls must show *something* is happening while its request is in flight,
// even though the underlying writes (optimistic set insert, near-instant favorite toggle) are
// often too fast to notice most of the time.
describe('ExerciseDetail in-flight visual feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('re-enables the Log Set button once the optimistic write lands, without waiting for the server', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    const button = (await screen.findByText('Log set')).closest('button');
    fireEvent.click(button);

    // The button's pending window is scoped to the optimistic cache write (which has no
    // network dependency), not the full request -- it should clear quickly even though the
    // mocked request below is still unresolved. This matters because with the old
    // mutateAsync-based wiring, the button would otherwise never re-enable if the request
    // were paused offline (see the offline test below) -- there's no timeout on that promise.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(logLiveSet).toHaveBeenCalled();
    expect(await screen.findByText(/Saving/)).toBeInTheDocument();

    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await waitFor(() => expect(screen.queryByText(/Saving/)).not.toBeInTheDocument());
  });

  it('allows editing/deleting a paused-offline set, then shows Saving once reconnected', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');
      fireEvent.click(button);

      // The tap-ack still resolves promptly even offline -- onMutate's cache write has no
      // network dependency -- so the button must not hang the way it would have under the
      // old mutateAsync-based wiring.
      await waitFor(() => expect(button).not.toBeDisabled());
      // TanStack pauses the mutation before ever invoking mutationFn while offline.
      expect(logLiveSet).not.toHaveBeenCalled();
      // A paused-offline set is just as editable/deletable as a synced one now (see
      // offlineSetEdits.js) -- no more opaque "Will sync..." placeholder.
      expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();

      onlineManager.setOnline(true);
      await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
      expect(await screen.findByText(/Saving/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

      listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
      resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument());
    } finally {
      // Restore the real default -- onlineManager's #online starts at `true` with no
      // navigator.onLine fallback in this TanStack version, so setOnline(undefined) would
      // leave it falsy (behaving as offline) rather than resetting it, leaking into every
      // later test in this file/run that shares this module-level singleton.
      onlineManager.setOnline(true);
    }
  });

  it('toggles favorite through the durable mutation (no blocking spinner -- it is optimistic)', async () => {
    listSessionSets.mockResolvedValue([]);
    // exercise.isFavorite starts true, so a click unfavorites via the durable mutation.
    const { unfavoriteExercise } = await import('../../api/exercises');
    unfavoriteExercise.mockResolvedValue({});
    renderExerciseDetail();

    const star = await screen.findByRole('button', { name: 'Remove from favorites' });
    fireEvent.click(star);

    await waitFor(() => expect(unfavoriteExercise).toHaveBeenCalledWith(7, 1));
    // The star is never disabled now -- the toggle is optimistic and queues durably offline.
    expect(star).not.toBeDisabled();
  });

  it('shows a "Saving..." indicator (no Edit/Delete yet) on a set until it is confirmed', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText(/Saving/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument());
    expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();
  });

  // Logging the very first set of a brand-new workout has no live session yet, so
  // onMutate has nowhere to write an optimistic row (queryKeys.sessionSets needs a real
  // session id). Without a placeholder, the "This session" section stays entirely absent
  // until the full create-session-and-log-set round trip completes -- these three tests
  // cover the placeholder that fills that gap (see pendingBeforeSession in
  // ExerciseDetail.jsx), derived from the shared MutationCache rather than local state.
  it('shows the entered weight/reps for the very first set of a brand-new workout (no session yet) while its write is in flight', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));

    // A harness that actually updates liveSession when refetchLiveSession is called --
    // renderExerciseDetail's default stub just resolves without touching any state, which
    // would leave contextSessionId null forever and never let the confirmed row appear
    // (LogTab's real refetchLiveSession does update the liveSession it passes down).
    function Harness() {
      const [liveSession, setLiveSession] = useState(null);
      return (
        <ExerciseDetail
          exercise={exercise}
          personId={7}
          editingSessionId={null}
          liveSession={liveSession}
          refetchLiveSession={async () => setLiveSession({ id: 101 })}
          onBack={vi.fn()}
        />
      );
    }
    renderWithQuery(<Harness />);

    // Before the click there's no session and nothing to show in "This session" -- the
    // heading only renders once displaySets is non-empty.
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
    expect(screen.getByText(/Saving/)).toBeInTheDocument();

    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument());
  });

  it('does not leak a pending placeholder into a different exercise after a mid-flight switch', async () => {
    const exerciseB = { id: 2, name: 'Squat', tags: [], isFavorite: false, setupFields: [] };
    listSessionSets.mockResolvedValue([]);
    let resolveLogA;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLogA = resolve; }));

    function Harness() {
      const [currentExercise, setCurrentExercise] = useState(exercise);
      return (
        <div>
          <button onClick={() => setCurrentExercise(exerciseB)}>switch</button>
          <ExerciseDetail
            exercise={currentExercise}
            personId={7}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </div>
      );
    }
    renderWithQuery(<Harness />);

    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(screen.getByText('This session')).toBeInTheDocument());

    // ExerciseDetail isn't remounted on an exercise switch (LogTab keys it on personId
    // only, matched by this harness's lack of a key) -- switching mid-flight must not show
    // exercise A's still-pending placeholder under exercise B.
    fireEvent.click(screen.getByText('switch'));
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    // Settle exercise A's still-outstanding request so it doesn't leak into a later test;
    // wrapped in act since nothing else here awaits the resulting state update.
    await act(async () => {
      resolveLogA({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await Promise.resolve();
    });
  });

  it('removes the placeholder automatically if the first set fails to save', async () => {
    listSessionSets.mockResolvedValue([]);
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    const clientError = Object.assign(new Error('Weight required'), { status: 400 });
    // Controlled rejection (not mockRejectedValue) -- an immediately-rejected promise can
    // leave 'pending' status before the placeholder assertion below ever gets to observe it.
    let rejectLog;
    logLiveSet.mockImplementation(() => new Promise((resolve, reject) => { rejectLog = reject; }));
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));
    expect(await screen.findByText('This session')).toBeInTheDocument();

    rejectLog(clientError);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Weight required', { tone: 'error' }));
    // No manual cleanup code runs here -- the mutation leaving 'pending' status on its own
    // is what drops it from pendingBeforeSession.
    await waitFor(() => expect(screen.queryByText('This session')).not.toBeInTheDocument());
  });

  // The weight/reps are already known (they're right in the mutation's own variables) the
  // instant a set is logged -- while genuinely offline there's no reason to show an opaque
  // shimmer instead of them, unlike the brief online round-trip above which still does.
  it('shows real weight/reps (not a skeleton) for the first set of a brand-new workout while paused offline', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));

      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(logLiveSet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('deleting a paused-offline set (before a session exists) cancels its pending create', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    useUI.mockReturnValue({
      showCelebration: vi.fn(),
      showToast: vi.fn(),
      startRestTimer: vi.fn(),
      openConfirm: (_msg, onConfirm) => onConfirm(),
    });
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));
      expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(screen.queryByText('135 lb × 8')).not.toBeInTheDocument());
      // Cancelled outright -- not left queued as a delete against a set id that doesn't exist.
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // Editing a not-yet-synced set no longer touches its queued create at all -- it queues a
  // genuinely separate, durable EDIT_SET write targeting the create's tempId (resolved once the
  // create syncs, see queryClient.js's requireResolvedSetId/setSetIdMapping and
  // offlineSetEdits.js's patchPendingLogSetDisplay). This is what makes editing a pending set
  // behave identically to editing a synced one in every connectivity mode, and avoids both
  // reordering the create in the shared outbox scope and the backend's idempotency dedup silently
  // discarding the edit if the create had already reached the server under lie-fi.
  it('editing a paused-offline set shows the corrected values immediately and queues a separate EDIT_SET, without removing or recreating the create', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    editSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    const { queryClient } = renderExerciseDetail({ liveSession: { id: 101 } });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));
      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();
      const createBefore = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      // Scoped to the modal dialog -- ExerciseDetail's own "log a new set" weight/reps steppers
      // stay mounted in the background behind the overlay and have their own "+"/"−" buttons too.
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getAllByText('+')[0]); // Weight stepper's "+" (Reps' is the second)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      // The row shows the correction immediately...
      expect(await screen.findByText('137.5 lb × 8')).toBeInTheDocument();
      // ...but the CREATE itself was never removed or recreated -- same object, same slot in the
      // shared outbox scope, so it can't be pushed out of enqueue order the way the old
      // replacePendingLogSet approach could.
      const create = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');
      expect(create).toBe(createBefore);
      expect(logLiveSet).not.toHaveBeenCalled();
      // A separate, genuinely new EDIT_SET write carries the correction.
      const edit = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'editSet');
      expect(edit).toBeDefined();
      expect(edit.state.variables).toMatchObject({ weight: 137.5, reps: 8 });
      expect(editSet).not.toHaveBeenCalled(); // still paused offline
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // pendingBeforeSession sorts by clientLoggedAt rather than trusting raw mutation-cache order --
  // now purely defensive (editing no longer reorders the cache; see the test above and
  // ExerciseDetail.jsx's comment on pendingBeforeSession), but the underlying guarantee ("Set N"
  // labels are position-based, so they must reflect true logging order regardless of array order)
  // is still worth protecting directly: construct a genuine mismatch (a set arriving in the cache
  // AFTER an earlier one, but with an EARLIER clientLoggedAt) and confirm the labels still land on
  // true chronological order, not array/insertion order.
  it('keeps "Set N" labels in true chronological (clientLoggedAt) order even when cache/array order disagrees', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');

      // "Set 2" (by array/insertion order): dispatched first, but with a LATER clientLoggedAt --
      // through the real UI flow.
      fireEvent.click(button);
      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();

      // "Set 1" (by true clientLoggedAt): dispatched SECOND against the mutation cache (bypassing
      // the mocked, static useAppState draft), but stamped with an EARLIER clientLoggedAt -- e.g.
      // an offline replay ordering quirk, independent of any edit.
      const mutationKey = ['logSet', 7, exercise.id];
      await act(async () => {
        new MutationObserver(queryClient, { ...queryClient.getMutationDefaults(mutationKey), mutationKey })
          .mutate({
            mode: 'live',
            personId: 7,
            sessionId: null,
            exerciseId: exercise.id,
            unit: 'lb',
            weight: 145,
            reps: 12,
            tempId: 'test-temp-2',
            idempotencyKey: 'test-idem-2',
            clientLoggedAt: new Date(Date.now() - 1000).toISOString(),
          })
          .catch(() => {});
      });

      // Despite arriving SECOND in the cache, its EARLIER clientLoggedAt puts it first on screen.
      const earlierRow = (await screen.findByText('145 lb × 12')).parentElement;
      expect(within(earlierRow).getByText('Set 1')).toBeInTheDocument();
      const laterRow = screen.getByText('135 lb × 8').parentElement;
      expect(within(laterRow).getByText('Set 2')).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // Nothing exists server-side to key a "session in progress" banner/dot on until this
  // queued write actually replays, so onMutate optimistically seeds a provisional session
  // (id: null, so it can never leak into contextSessionId/activeSessionId or any id-keyed
  // query -- see ExerciseDetail.jsx's onMutate) directly into the same liveSession cache
  // entry LogTab/PersonPillBar already read.
  it('seeds a provisional live session (id: null) while offline so the banner/dot can appear before syncing', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {}));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));

      await waitFor(() =>
        expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
          expect.objectContaining({ id: null, startedAt: expect.any(String) }),
        ),
      );
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // The raw cache can still hold a session this device has ENDED -- useLiveSession hides it, so
  // this screen sees no session, but `prev ?? placeholder` used to keep it, leaving the new workout
  // with no placeholder at all: no banner, no dot. docs/incidents/2026-09-23-end-workout-mid-save-resurrected.md
  it('seeds a fresh provisional session over an ended one left in the cache', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {}));
    const { queryClient } = renderExerciseDetail({ liveSession: null });
    queryClient.setQueryData(queryKeys.liveSession(7), { id: 88, startedAt: '2026-09-23T10:00:00Z' });
    markSessionEnded(7, 88);

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));

      await waitFor(() =>
        expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
          expect.objectContaining({ id: null, startedAt: expect.any(String) }),
        ),
      );
    } finally {
      onlineManager.setOnline(true);
      // No global storage reset between tests -- don't leave an ended id behind for later ones.
      localStorage.removeItem('worktrac-ended-session:7');
    }
  });

  it('keeps the earliest offline-logged start time across multiple sets before the session syncs', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {}));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');
      fireEvent.click(button);
      await waitFor(() => expect(queryClient.getQueryData(queryKeys.liveSession(7))).toBeTruthy());
      const firstStartedAt = queryClient.getQueryData(queryKeys.liveSession(7)).startedAt;

      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);

      // Still the first set's timestamp -- the second dispatch must not clobber it.
      expect(queryClient.getQueryData(queryKeys.liveSession(7)).startedAt).toBe(firstStartedAt);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // The seed is unconditional (not gated on online/offline): a set logged against a server that's
  // slow, unreachable, or down is just as "session started" as one logged genuinely offline --
  // the banner must never wait on a request that might take a while (or never) to confirm. The
  // ordinary fast online round-trip still reconciles to the real session within a fraction of a
  // second via refetchLiveSession/the registered invalidation, same as before.
  it('seeds a provisional live session immediately even for the ordinary online first-set round trip', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLog = resolve; }));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());

    expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
      expect.objectContaining({ id: null, startedAt: expect.any(String) }),
    );

    await act(async () => {
      resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await Promise.resolve();
    });
  });

  // The server-down repro: online (not paused), but the write never confirms because the backend
  // is unreachable. Once shouldRetryWrite's retries are exhausted (immediately here, since the
  // test client registers retry:false) the mutation settles into a transient (non-4xx) error --
  // this must render exactly like a paused-offline set (real numbers, Edit/Delete, no alarm),
  // not get stuck as an indefinite "Saving..." skeleton with no session banner.
  it('shows real weight/reps and stays editable -- not stuck on "Saving..." -- when a first set terminal-errors against an unreachable server', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockRejectedValue({ status: 500 });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(screen.getByText('135 lb × 8')).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();
  });

  it('seeds the provisional live session even when the first set terminal-errors against an unreachable server', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockRejectedValue({ status: 503 });
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
        expect.objectContaining({ id: null, startedAt: expect.any(String) }),
      ),
    );
  });

  it('does not roll back the set or show an alarming toast for a transient (non-4xx) failure -- it stays queued instead', async () => {
    listSessionSets.mockResolvedValue([]);
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    logLiveSet.mockRejectedValue({ status: 500 });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(screen.getByText('135 lb × 8')).toBeInTheDocument());
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByText('This session')).toBeInTheDocument();
  });
});

// Regression tests: the "This session" sets column used to be gated on `ready`
// (!summaryQuery.isLoading && !customFieldsQuery.isLoading), even though displaySets
// (optimistic rows + sessionSets) needs neither query. Against a down/hanging backend,
// summaryQuery.isLoading can stay true for tens of seconds (15s timeout x retries), during
// which an already-logged (or already-synced) set would vanish from view for no reason. The
// sets column must render as soon as its own data is available, independent of the summary
// read's loading state -- only the summary cards legitimately wait on `ready`.
describe('ExerciseDetail sets list independent of the summary/PR read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders an already-synced set immediately even while the summary/PR read is still hanging', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- simulates DB down
    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
    // The summary cards, unlike the sets list, legitimately stay in their loading state.
    expect(screen.queryByText(/Last time/)).not.toBeInTheDocument();
  });

  it('renders a freshly-logged set immediately even while the summary/PR read is still hanging', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- simulates DB down
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // write also hangs against the down server
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
    expect(screen.queryByText(/Last time/)).not.toBeInTheDocument();
  });
});

// Exercise Detail's "Last time"/"Best est. 1RM" card is interaction-scoped (queryKeys.exerciseSummary
// is keyed on personId + exerciseId + contextSessionId), so it's realistic to open a given
// (exercise, session) combination for the first time while the live query can't get an answer --
// either genuinely offline, or online-but-unreachable ("lie-fi"). Both must resolve from the
// already-warmed history cache (see offlineCacheWarm.js / exerciseSummaryFromHistory.js) instead
// of hanging on a skeleton or falsely showing "No sets yet"/"No PR yet".
describe('ExerciseDetail summary fallback to warmed history (offline + lie-fi)', () => {
  const historyWithBenchPress = [
    {
      id: 55,
      startedAt: '2026-07-01T12:00:00Z',
      endedAt: '2026-07-01T13:00:00Z',
      manual: false,
      entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
  });

  it('derives Last time/Best est. 1RM from the warmed history cache when hard offline with no exerciseSummary cache entry', async () => {
    // Never resolves -- while offline, TanStack pauses the fetch before invoking this at all.
    getExerciseSummary.mockImplementation(() => new Promise(() => {}));

    // Seed the history cache directly rather than going through a live fetch: going offline
    // BEFORE render (as the real scenario requires, so exerciseSummary's own fetch is paused
    // rather than merely "still fetching") would equally pause history's own first fetch if it
    // had to happen live here -- exactly the bug this test is meant to prove is fixed. Seeding
    // models "history was already warmed while online, sometime before this component mounted",
    // which is what offlineCacheWarm.js actually guarantees in the real app.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    registerOfflineMutationDefaults(queryClient, { retry: false });
    queryClient.setQueryData(queryKeys.history(7), historyWithBenchPress);

    onlineManager.setOnline(false);
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <ExerciseDetail
            exercise={exercise}
            personId={7}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText('135lb×8')).toBeInTheDocument();
      expect(screen.getByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();
      expect(getExerciseSummary).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('derives Last time/Best est. 1RM from the warmed history cache during lie-fi (fetch attempted but fails)', async () => {
    getHistory.mockResolvedValue(historyWithBenchPress);
    // Stays online per onlineManager, but the request itself fails -- e.g. a rejected fetch
    // against an unreachable backend. Test client has retry: false, so this settles fast.
    getExerciseSummary.mockRejectedValue(new Error('network error'));

    renderExerciseDetail();

    expect(await screen.findByText('135lb×8')).toBeInTheDocument();
    expect(screen.getByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();
    await waitFor(() => expect(getExerciseSummary).toHaveBeenCalled());
  });

  it('still shows the normal loading state (not a premature "No sets yet") while the request is merely slow, not paused or errored', async () => {
    getHistory.mockResolvedValue(historyWithBenchPress);
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- online, still in flight

    renderExerciseDetail();

    await waitFor(() => expect(screen.queryByText(/Last time/)).not.toBeInTheDocument());
    expect(screen.queryByText('135lb×8')).not.toBeInTheDocument();
  });
});

// `history` is server data that is only ever INVALIDATED after a write, never optimistically
// written (queryClient.js) -- and invalidation is a no-op while paused/unreachable. So a best
// derived from it alone freezes at the moment connectivity dropped, while displaySets keeps
// showing the sets logged since. Because isPrSet asks "does this TIE the all-time best" (a
// tolerance match, not a strict improvement), that stale best doesn't merely omit a badge -- it
// moves it onto the wrong row: a genuine offline PR goes unbadged while a later, lighter set that
// happens to tie the PRE-offline best gets badged instead.
describe('ExerciseDetail PR badge folds in sets that have not synced yet', () => {
  // Bench Press 135x8 -> comparableLb 171. An offline 185x8 -> 234.3, a genuine PR.
  const historyWithBenchPress = [
    {
      id: 55,
      startedAt: '2026-07-01T12:00:00Z',
      endedAt: '2026-07-01T13:00:00Z',
      manual: false,
      entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
    },
  ];

  let draftWeight;

  beforeEach(() => {
    vi.clearAllMocks();
    draftWeight = 185;
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    // mockImplementation (not mockReturnValue) so the draft can change between the two logged
    // sets below -- the component reads it fresh on every render. Mutating draftWeight models the
    // person re-typing the weight after the previous set, hence typedDraft's ownership stamp.
    useAppState.mockImplementation(() => typedDraft({ weight: draftWeight }));
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
  });

  // ExerciseDetail is deliberately NOT remounted between the two sets (LogTab keys it on personId
  // only), so the force button just gives the component a render in which to pick up the new
  // draft -- exactly what tapping the weight stepper would do in the real app.
  function Harness() {
    const [, force] = useState(0);
    return (
      <div>
        <button onClick={() => force((n) => n + 1)}>force render</button>
        <ExerciseDetail
          exercise={exercise}
          personId={7}
          editingSessionId={null}
          liveSession={null}
          refetchLiveSession={vi.fn().mockResolvedValue()}
          onBack={vi.fn()}
        />
      </div>
    );
  }

  function rowFor(text) {
    return screen.getByText(text).parentElement;
  }

  function logSetButton() {
    return screen.getByText('Log set').closest('button');
  }

  it('badges a genuine PR logged while hard offline, and does not badge a later set that only ties the pre-offline best', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // paused offline -- never invoked

    // Seeded rather than fetched: going offline before render would equally pause history's own
    // first fetch. This models "history was warmed while online", which offlineCacheWarm.js
    // guarantees in the real app -- same rationale as the fallback suite above.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    registerOfflineMutationDefaults(queryClient, { retry: false });
    queryClient.setQueryData(queryKeys.history(7), historyWithBenchPress);

    onlineManager.setOnline(false);
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );

      // Baseline: the warmed-history best, before anything is logged this session.
      expect(await screen.findByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Log set'));
      expect(await screen.findByText('185 lb × 8')).toBeInTheDocument();

      // The offline set beats the warmed best, so it is the PR -- and the Best card must move
      // with it, even though `history` cannot know about it until the outbox drains.
      expect(within(rowFor('185 lb × 8')).getByTitle(/^Personal record/)).toBeInTheDocument();
      expect(screen.getByText(/234.3 lb\s*\(185lb×8\)/)).toBeInTheDocument();

      // ⚠️ It NAMES which records fell, exactly as History does -- this row took both, because
      // 185 beats the 135 top weight as well as the 171 est. 1RM. The old green "PR" token said
      // only "Personal record" and knew about est. 1RM alone, so a top-weight record went
      // unmarked here while History marked it.
      expect(within(rowFor('185 lb × 8')).getByTitle('Personal record: top weight, est. 1rm')).toBeInTheDocument();

      draftWeight = 135;
      fireEvent.click(screen.getByText('force render'));
      // Button keeps itself disabled for MIN_PENDING_MS (400ms) after a click, so a second click
      // fired immediately would be silently swallowed.
      await waitFor(() => expect(logSetButton()).not.toBeDisabled());
      fireEvent.click(screen.getByText('Log set'));
      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();

      // The lighter set ties the PRE-offline best (171) but not the real one (234.3). Exactly one
      // badge, and it is still on the 185 row.
      expect(screen.getAllByTitle(/^Personal record/)).toHaveLength(1);
      expect(within(rowFor('185 lb × 8')).getByTitle(/^Personal record/)).toBeInTheDocument();
      expect(within(rowFor('135 lb × 8')).queryByTitle(/^Personal record/)).not.toBeInTheDocument();
      expect(logLiveSet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('badges a genuine PR logged during lie-fi (summary fetch attempted but failing)', async () => {
    getHistory.mockResolvedValue(historyWithBenchPress);
    // Online per onlineManager, but the backend is unreachable -- the fetch IS attempted and
    // settles into isError, which is the state isPaused alone would miss.
    getExerciseSummary.mockRejectedValue(new Error('network error'));
    logLiveSet.mockImplementation(() => new Promise(() => {})); // hangs -- write stays queued

    renderWithQuery(<Harness />);

    expect(await screen.findByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Log set'));
    expect(await screen.findByText('185 lb × 8')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/234.3 lb\s*\(185lb×8\)/)).toBeInTheDocument());
    expect(within(rowFor('185 lb × 8')).getByTitle(/^Personal record/)).toBeInTheDocument();
  });

  // The fold is a max over what is on screen, so it can only ever RAISE the best -- it must never
  // pull a genuinely higher server best down to a lesser set logged this session.
  it('keeps the server best when the set logged offline does not beat it', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {}));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    registerOfflineMutationDefaults(queryClient, { retry: false });
    queryClient.setQueryData(queryKeys.history(7), [
      {
        id: 55,
        startedAt: '2026-07-01T12:00:00Z',
        endedAt: '2026-07-01T13:00:00Z',
        manual: false,
        entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 225, reps: 8, unit: 'lb' }], note: null }],
      },
    ]);

    onlineManager.setOnline(false);
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/285 lb\s*\(225lb×8\)/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Log set')); // 185x8 -> 234.3, below the 285 best
      expect(await screen.findByText('185 lb × 8')).toBeInTheDocument();

      expect(screen.getByText(/285 lb\s*\(225lb×8\)/)).toBeInTheDocument();
      expect(screen.queryByTitle(/^Personal record/)).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('ExerciseDetail weight prefill', () => {
  // A stateful useAppState: the prefill effect writes through setDraft, so a fixed mockReturnValue
  // would show what the test seeded rather than what the component computed. Mirrors the reducer's
  // SET_DRAFT case exactly -- all five fields written together, starting unowned so the prefill is
  // free to seed it.
  function Harness({ liveSession = null }) {
    const [slice, setSlice] = useState({
      weightDraft: null,
      repsDraft: 8,
      draftExerciseId: null,
      draftSetCount: 0,
      draftSource: 'prefill',
    });
    useAppState.mockImplementation(() => ({
      ...slice,
      setHoldStartedAt: vi.fn(),
      setRestTimer: vi.fn(),
      setDraft: ({ exerciseId, weight, reps, setCount, source }) =>
        setSlice({
          weightDraft: weight,
          repsDraft: reps,
          draftExerciseId: exerciseId,
          draftSetCount: setCount,
          draftSource: source,
        }),
    }));
    return (
      <ExerciseDetail
        exercise={exercise}
        personId={7}
        editingSessionId={null}
        liveSession={liveSession}
        refetchLiveSession={vi.fn().mockResolvedValue()}
        onBack={vi.fn()}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows an em dash rather than a number when the exercise has no history', async () => {
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });

    renderWithQuery(<Harness />);

    const weightInput = await screen.findByLabelText('Weight (lb)');
    expect(weightInput).toHaveValue('');
    expect(weightInput).toHaveAttribute('placeholder', '—');
  });

  it('logs a blank weight as 0 instead of refusing the tap', async () => {
    // The bodyweight case: a first-ever pull-up is correct with no interaction at all, and
    // blocking the button would punish it to protect a weighted lift where the em dash is
    // already visibly not a number.
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });

    renderWithQuery(<Harness />);
    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ weight: 0, reps: 8 })));
  });

  it("carries today's last set forward when there is no prior session", async () => {
    // Without this the draft snapped back to the empty default before every set of a brand-new
    // exercise's first-ever workout, because prefill only ever read the PREVIOUS session.
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([{ id: 1, weight: 135, reps: 5, unit: 'lb' }]);

    renderWithQuery(<Harness liveSession={{ id: 101 }} />);

    // Unlike the old button (whose aria-label embedded the value, so findByLabelText itself
    // polled until it updated), the input's label is constant -- it exists from first render,
    // before the prefill effect has applied. Wait for the VALUE, not just the element.
    await waitFor(() => expect(screen.getByLabelText('Weight (lb)')).toHaveValue('135'));
    expect(screen.getByLabelText('Reps')).toHaveValue('5');
  });

  it('still prefers the prior session over the sets logged today', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: { sets: [{ weight: 225, reps: 3, unit: 'lb' }] },
      best: null,
    });
    listSessionSets.mockResolvedValue([{ id: 1, weight: 135, reps: 5, unit: 'lb' }]);

    renderWithQuery(<Harness liveSession={{ id: 101 }} />);

    await waitFor(() => expect(screen.getByLabelText('Weight (lb)')).toHaveValue('225'));
  });
});

// The draft is per-PERSON state living in AppStateProvider (above the router), while the value on
// screen is per-EXERCISE and may have been typed by hand. Nothing used to reconcile those: the
// draft carried no record of which exercise it described, what set count it was computed against,
// or whether the person had since typed over it. Two separate bugs came out of that gap, and both
// are pinned here.
//
// Every case mocks useAppState with an INERT setter, so a value that reads back correctly can only
// have been derived during render -- never written by the prefill effect. That is the whole point:
// the effect runs after paint at best, and not at all until this exercise's summary lands.
describe('ExerciseDetail draft ownership', () => {
  let setDraft;

  // Seeds the whole slice, including the stamp fields. `overrides` is the interesting part of each
  // case; everything else is a neutral default.
  function mockDraft(overrides) {
    setDraft = vi.fn();
    useAppState.mockReturnValue({
      weightDraft: null,
      repsDraft: 8,
      draftExerciseId: null,
      draftSetCount: 0,
      draftSource: 'prefill',
      setDraft,
      setHoldStartedAt: vi.fn(),
      setRestTimer: vi.fn(),
      ...overrides,
    });
  }

  // Nothing re-seeded the draft. setDraft is the only way to write one, so this is exhaustive.
  function expectNoReseed() {
    expect(setDraft).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never paints a draft belonging to a different exercise', async () => {
    // `exercise` is id 1; the slice still holds what was computed for id 999 a moment ago. Both
    // navigation paths reach this state -- the routine strip switches the `exercise` prop without
    // remounting, and the picker unmounts/remounts but the draft outlives it in AppStateProvider.
    mockDraft({ weightDraft: 185, repsDraft: 5, draftExerciseId: 999, draftSource: 'user' });
    getExerciseSummary.mockResolvedValue({
      lastSession: { sets: [{ weight: 95, reps: 12, unit: 'lb' }] },
      best: null,
    });

    renderExerciseDetail();

    await waitFor(() => expect(screen.getByLabelText('Weight (lb)')).toHaveValue('95'));
    expect(screen.getByLabelText('Reps')).toHaveValue('12');
  });

  it('shows the em dash, not the previous exercise, while this exercise has no summary yet', async () => {
    // The long window: uncached summary, or lie-fi where retries must exhaust before the derived
    // fallback takes over. "Not known yet" is honest; another exercise's number is not.
    mockDraft({ weightDraft: 185, repsDraft: 5, draftExerciseId: 999, draftSource: 'user' });
    getExerciseSummary.mockReturnValue(new Promise(() => {}));

    renderExerciseDetail();

    const weightInput = await screen.findByLabelText('Weight (lb)');
    await waitFor(() => expect(weightInput).toHaveValue(''));
    expect(weightInput).toHaveAttribute('placeholder', '—');
    expect(screen.getByLabelText('Reps')).toHaveValue('');
  });

  it('does not let a settling summary overwrite a weight the person typed', async () => {
    // The 2026-08-08 lower failure, at unit level: the person types 315, a late summary settles,
    // the re-seed stomps it, and "Log set" then logs the prior session's weight instead. Locally
    // the queries return in milliseconds so this almost never lost -- hence a full green local
    // suite and a red deployed one.
    mockDraft({ weightDraft: 315, repsDraft: 5, draftExerciseId: 1, draftSetCount: 0, draftSource: 'user' });
    getExerciseSummary.mockResolvedValue({
      lastSession: { sets: [{ weight: 225, reps: 3, unit: 'lb' }] },
      best: null,
    });

    renderExerciseDetail();

    // The "Last time" pill needs both the resolved summary and `ready`, so past this point a
    // re-seed would already have fired.
    await screen.findByText('225lb×3');

    expect(screen.getByLabelText('Weight (lb)')).toHaveValue('315');
    expect(screen.getByLabelText('Reps')).toHaveValue('5');
    expectNoReseed();
  });

  it('keeps a typed value through the sessionSets reload that follows a remount', async () => {
    // Leaving to the picker unmounts ExerciseDetail (LogTab renders it under `selectedExercise &&`)
    // and reopening remounts it, so displaySets.length is transiently 0 while sessionSets reloads.
    // A re-seed rule keyed on "the count CHANGED" reads that as "a set was logged" and destroys the
    // typed value; only an INCREASE may re-seed.
    mockDraft({ weightDraft: 315, repsDraft: 5, draftExerciseId: 1, draftSetCount: 2, draftSource: 'user' });
    getExerciseSummary.mockResolvedValue({
      lastSession: { sets: [{ weight: 225, reps: 3, unit: 'lb' }] },
      best: null,
    });
    let resolveSets;
    listSessionSets.mockReturnValue(new Promise((resolve) => {
      resolveSets = resolve;
    }));

    renderExerciseDetail({ liveSession: { id: 101 } });

    await screen.findByText('225lb×3');
    expect(screen.getByLabelText('Weight (lb)')).toHaveValue('315');

    await act(async () => {
      resolveSets([
        { id: 1, weight: 135, reps: 5, unit: 'lb' },
        { id: 2, weight: 135, reps: 5, unit: 'lb' },
      ]);
    });

    expect(screen.getByLabelText('Weight (lb)')).toHaveValue('315');
    expectNoReseed();
  });

  it('still re-seeds the carry-forward once a set is actually logged', async () => {
    // The counterpart to the case above -- ownership must not become a permanent lock, or the
    // carry-forward (the thing that stops a brand-new exercise re-seeding to blank before every
    // set of its first workout) silently dies.
    mockDraft({ weightDraft: 315, repsDraft: 5, draftExerciseId: 1, draftSetCount: 0, draftSource: 'user' });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([{ id: 1, weight: 135, reps: 8, unit: 'lb' }]);

    renderExerciseDetail({ liveSession: { id: 101 } });

    await waitFor(() =>
      expect(setDraft).toHaveBeenCalledWith(
        expect.objectContaining({ exerciseId: 1, weight: 135, reps: 8, source: 'prefill' }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Duration-tracked exercises: same screen, same two steppers, only the second one's meaning
// changes. exercise.trackingType is the one flag that decides it.
// ---------------------------------------------------------------------------------------------
describe('ExerciseDetail duration-tracked exercises', () => {
  const plank = { id: 1, name: 'Plank', trackingType: 'duration', tags: [], isFavorite: true, setupFields: [] };
  let setDraft;
  let startHoldTimer;
  let stopHoldTimer;
  let setHoldStartedAt;

  function mockUI({ holdTimers = {} } = {}) {
    startHoldTimer = vi.fn();
    stopHoldTimer = vi.fn();
    useUI.mockReturnValue({
      showCelebration: vi.fn(),
      showToast: vi.fn(),
      startRestTimer: vi.fn(),
      openConfirm: vi.fn(),
      holdTimers,
      startHoldTimer,
      stopHoldTimer,
    });
  }

  function mockDraft(overrides = {}) {
    setDraft = vi.fn();
    setHoldStartedAt = vi.fn();
    useAppState.mockReturnValue({
      weightDraft: 0,
      repsDraft: 8,
      durationDraft: 60,
      holdStartedAt: null,
      draftExerciseId: plank.id,
      draftSetCount: TYPED_AFTER_EVERYTHING,
      draftSource: 'user',
      setDraft,
      setHoldStartedAt,
      setRestTimer: vi.fn(),
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    mockDraft();
    mockUI();
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockResolvedValue({
      set: { id: 1, weight: 0, reps: 0, durationSeconds: 60, unit: 'lb' },
      session: { id: 101 },
      isPR: false,
      best: null,
    });
  });

  it('shows a Time stepper instead of Reps, formatted as m:ss', async () => {
    renderExerciseDetail({ exercise: plank });

    expect(await screen.findByLabelText('Time')).toHaveValue('1:00');
    expect(screen.queryByLabelText('Reps')).toBeNull();
    // Weight keeps its label and meaning -- added load, 0 = bodyweight.
    expect(screen.getByLabelText('Weight (lb)')).toBeInTheDocument();
  });

  it('logs the duration with zero reps, never reps carrying the seconds', async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByRole('button', { name: /Log set/ }));

    await waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ exerciseId: 1, weight: 0, reps: 0, durationSeconds: 60 }),
      ),
    );
  });

  it('steps the time by 5 seconds, not 1', async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByTitle('Increase Time'));
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 65, source: 'user' }));

    fireEvent.click(screen.getByTitle('Decrease Time'));
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 55, source: 'user' }));
  });

  // The value must not change shape under your finger: it reads 1:00 unfocused and stays 1:00 when
  // you tap it. Swapping in "60" on focus silently teaches that only raw seconds are accepted.
  it('keeps the m:ss formatting while focused', async () => {
    renderExerciseDetail({ exercise: plank });

    const input = await screen.findByLabelText('Time');
    fireEvent.focus(input);
    expect(input).toHaveValue('1:00');
  });

  // The Time field opens the wheel rather than a keyboard, which is the whole point: a numeric
  // keypad has no colon key, so m:ss was never typeable on the device this app is used on.
  it('opens the duration picker instead of a keyboard when the time is tapped', async () => {
    renderExerciseDetail({ exercise: plank });

    const input = await screen.findByLabelText('Time');
    // readOnly is what suppresses the mobile keyboard; without it the picker and the keyboard
    // both appear and fight over the bottom of the screen.
    expect(input).toHaveAttribute('readonly');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(input);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Minutes' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeInTheDocument();
  });

  it("commits a time picked on the wheel, stamped as the person's own", async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByLabelText('Time'));
    // Digit typeahead: 4 then 5 joins into 45 seconds, against the 1 minute already on the wheel.
    // This is also exactly what the e2e helper drives, because scroll-driving a snap container
    // from a test is inherently flaky.
    const seconds = screen.getByRole('listbox', { name: 'Seconds' });
    fireEvent.keyDown(seconds, { key: '4' });
    fireEvent.keyDown(seconds, { key: '5' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 105, source: 'user' }));
  });

  it('picks a time with the arrow keys', async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByLabelText('Time'));
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Seconds' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 61, source: 'user' }));
  });

  // Clear has to be commitable or it's a dead end. 0:00 isn't a loggable hold, so it lands in the
  // same "no value chosen" blank that Weight and Reps use -- rendered as the em-dash placeholder.
  it('clears the time back to blank', async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByLabelText('Time'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: null, source: 'user' }));
  });

  it('renders a cleared time as an em dash, and still logs a set', async () => {
    mockDraft({ durationDraft: null });
    renderExerciseDetail({ exercise: plank });

    expect(await screen.findByLabelText('Time')).toHaveValue('');

    // Blank is a display state, never a validation gate -- the same rule weight and reps follow.
    fireEvent.click(screen.getByRole('button', { name: /Log set/ }));
    await waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ reps: 0, durationSeconds: 30 })),
    );
  });

  // Turning the wheel is not a decision -- only Done is. Otherwise a stray Escape mid-set would
  // silently overwrite the time rather than silently discard an edit. The sheet has no Cancel of
  // its own: the header X is the discard path, and duplicating it only widens the row.
  it('leaves the draft alone when the picker is dismissed', async () => {
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByLabelText('Time'));
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Seconds' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Mid-hold the field is a live readout of the timer. Opening a picker onto a number that is
  // moving underneath it has no coherent answer for what happens when you let go.
  it('does not open the picker while a hold is running', async () => {
    mockUI({ holdTimers: { 7: { elapsed: 12 } } });
    renderExerciseDetail({ exercise: plank });

    const input = await screen.findByLabelText('Time');
    expect(input).toHaveValue('0:12');

    fireEvent.click(input);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Stepping off the bottom clears the field rather than parking on 0:01 -- the same "no duration
  // chosen" blank Clear produces. 0:01 left sitting there would read as a deliberate choice.
  it('clears the time when the last step takes it to zero or below', async () => {
    mockDraft({ durationDraft: 5 });
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByTitle('Decrease Time'));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: null, source: 'user' }));
  });

  it('clears rather than going negative from an odd remainder', async () => {
    mockDraft({ durationDraft: 3 });
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByTitle('Decrease Time'));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: null, source: 'user' }));
  });

  it('still steps normally while there is room above zero', async () => {
    mockDraft({ durationDraft: 10 });
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByTitle('Decrease Time'));

    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 5, source: 'user' }));
  });

  it('logs at least one second even if the hold was stopped at zero', async () => {
    mockDraft({ durationDraft: 0 });
    renderExerciseDetail({ exercise: plank });

    fireEvent.click(await screen.findByRole('button', { name: /Log set/ }));

    await waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ reps: 0, durationSeconds: 1 })),
    );
  });

  it('renders a logged hold as a time, not as a weight x reps row', async () => {
    listSessionSets.mockResolvedValue([{ id: 1, weight: 0, reps: 0, durationSeconds: 45, unit: 'lb' }]);
    renderExerciseDetail({ exercise: plank, liveSession: { id: 101 } });

    // Scoped to the set row: the Best card legitimately shows the same time, since this hold is
    // also the person's longest.
    const row = (await screen.findByText('Set 1')).parentElement;
    expect(within(row).getByText('0:45')).toBeInTheDocument();
  });

  it('renders a loaded hold with its added weight', async () => {
    listSessionSets.mockResolvedValue([{ id: 1, weight: 25, reps: 0, durationSeconds: 90, unit: 'lb' }]);
    renderExerciseDetail({ exercise: plank, liveSession: { id: 101 } });

    const row = (await screen.findByText('Set 1')).parentElement;
    expect(within(row).getByText('25 lb × 1:30')).toBeInTheDocument();
  });

  it('names the Best card after the record a hold actually has', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: null,
      best: { weight: 0, reps: 0, durationSeconds: 105, unit: 'lb', est1rm: null },
    });
    renderExerciseDetail({ exercise: plank, liveSession: { id: 101 } });

    expect(await screen.findByText('Longest hold')).toBeInTheDocument();
    expect(screen.getByText('1:45')).toBeInTheDocument();
  });

  it('a strength exercise is completely untouched -- still Reps, still no timer', async () => {
    mockDraft({ draftExerciseId: exercise.id, weightDraft: 135, repsDraft: 8 });
    renderExerciseDetail({ exercise });

    expect(await screen.findByLabelText('Reps')).toBeInTheDocument();
    expect(screen.queryByLabelText('Time')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start timer' })).toBeNull();
  });

  describe('the hold timer', () => {
    it('starts a per-person hold and persists its start timestamp', async () => {
      renderExerciseDetail({ exercise: plank });

      fireEvent.click(await screen.findByRole('button', { name: 'Start timer' }));

      expect(startHoldTimer).toHaveBeenCalledWith(7, expect.any(Number));
      // Persisted synchronously so swUpdate's silent post-deploy reload resumes the hold instead
      // of destroying it mid-effort.
      expect(setHoldStartedAt).toHaveBeenCalledWith(expect.any(Number));
    });

    it('shows live elapsed time in the Time field while running', async () => {
      mockUI({ holdTimers: { 7: { startedAt: 0, elapsed: 42 } } });
      renderExerciseDetail({ exercise: plank });

      expect(await screen.findByLabelText('Time')).toHaveValue('0:42');
      expect(screen.getByRole('button', { name: /Stop timer/ })).toHaveTextContent('0:42');
    });

    // Stop fills the field and nothing else. A mis-tap must never commit a set, and "review, then
    // tap Log set" is what the primary button means on every other exercise.
    it('stopping writes the elapsed seconds into the draft without logging', async () => {
      mockUI({ holdTimers: { 7: { startedAt: 0, elapsed: 42 } } });
      stopHoldTimer.mockReturnValue(42);
      renderExerciseDetail({ exercise: plank });

      fireEvent.click(await screen.findByRole('button', { name: /Stop timer/ }));

      expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 42, source: 'user' }));
      expect(logLiveSet).not.toHaveBeenCalled();
      expect(setHoldStartedAt).toHaveBeenCalledWith(null);
    });

    it('logging while the timer runs uses the timer value, not the stale draft', async () => {
      mockUI({ holdTimers: { 7: { startedAt: 0, elapsed: 88 } } });
      stopHoldTimer.mockReturnValue(88);
      renderExerciseDetail({ exercise: plank });

      fireEvent.click(await screen.findByRole('button', { name: /Log set/ }));

      await waitFor(() =>
        expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ durationSeconds: 88, reps: 0 })),
      );
    });

    it('resumes a hold that was running when the document died', async () => {
      mockDraft({ holdStartedAt: 1755000000000 });
      renderExerciseDetail({ exercise: plank });

      await waitFor(() => expect(startHoldTimer).toHaveBeenCalledWith(7, 1755000000000));
    });
  });
});


// Everything behind "Customize this exercise" is a Tier-3 write that posts the exercise id straight
// to `api/*` -- rename, tags, setup fields, delete -- and none of them resolve a temp id, unlike the
// durable writes which go through requireResolvedExerciseId. Against `temp-exercise-<uuid>` those
// requests 404 and the change silently does not happen: the setup field you just added simply never
// appears, with no error and no sign the tap was discarded.
//
// It surfaced on lower as admin.spec.ts's "a custom setup field lets each person set their own value
// for it" failing all three attempts. That spec creates an exercise and opens Customize immediately.
// Before #186 the create awaited a catalog refetch first, which was long enough online that the
// create had synced and the selection had migrated to the real id by the time anything could be
// tapped; removing that wait made the window genuinely reachable. Offline it was always reachable,
// and always broken.
describe('ExerciseDetail Customize is unavailable until the exercise exists on the server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  it('disables Customize while the exercise id is still a temp id', () => {
    renderExerciseDetail({ exercise: { ...exercise, id: 'temp-exercise-abc', optimistic: true } });

    // Disabled rather than hidden, and rather than locking the controls inside the modal: this is
    // the same "disable the Tier-3 entry point up front" call OfflineDisabledWrap makes elsewhere,
    // and a disabled button fails Playwright's actionability check, so a click WAITS for the
    // exercise to sync instead of firing at an id the server has never seen.
    expect(screen.getByRole('button', { name: 'Customize this exercise' })).toBeDisabled();
  });

  it('enables it once the exercise carries a real server id', () => {
    renderExerciseDetail();
    expect(screen.getByRole('button', { name: 'Customize this exercise' })).toBeEnabled();
  });

  it('does not disable the durable controls, which resolve temp ids themselves', () => {
    // Favorite and the session note are durable writes in the outbox scope; they queue against the
    // temp id and resolve it on replay. Disabling them would break offline logging, which is the
    // whole point of being able to create an exercise before it has synced.
    renderExerciseDetail({ exercise: { ...exercise, id: 'temp-exercise-abc', optimistic: true } });

    expect(screen.getByRole('button', { name: /favorites/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /note for this session/ })).toBeEnabled();
  });
});


// Every write behind "Customize this exercise" is a PER-PERSON one -- standing note, tags, setup
// fields, all PersonExerciseController/personScoped -- so on somebody ELSE's screen every one of
// them 403s. Its two neighbours in that action row were ReadOnlyWrapped and this was not, which
// left a live button between two greyed ones opening a modal where nothing could save. A member
// looking at a sibling's Log screen could type a standing note, blur, and get "That didn't save."
//
// Driven through the REAL useAccountAccess by supplying a membership, rather than mocking the hook:
// what is being pinned is that the wrap reaches the button, and a stubbed predicate would pass just
// as happily against a component that never asked.
describe('ExerciseDetail Customize is read-only on somebody else\u2019s screen', () => {
  function mockCommon() {
    vi.clearAllMocks();
    useAppState.mockReturnValue(typedDraft());
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  }

  // personId 99 is somebody else: ExerciseDetail is rendered for person 7.
  function asMemberViewingSomeoneElse() {
    mockCommon();
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [],
      membership: { accountRole: 'MEMBER', personId: 99 },
    });
  }

  function asMemberOnTheirOwnScreen() {
    mockCommon();
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [],
      membership: { accountRole: 'MEMBER', personId: 7 },
    });
  }

  it('disables Customize when the screen belongs to another person', () => {
    asMemberViewingSomeoneElse();
    renderExerciseDetail();

    expect(screen.getByRole('button', { name: 'Customize this exercise' })).toBeDisabled();
    // Its neighbours, which were already wrapped -- asserted alongside so the three read as one row.
    expect(screen.getByRole('button', { name: /favorites/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /note for this session/ })).toBeDisabled();
  });

  it('disables the pinned standing note too, since it opens the same modal', () => {
    asMemberViewingSomeoneElse();
    renderExerciseDetail({ exercise: { ...exercise, note: 'Keep elbows tucked' } });

    // Still readable -- only the route into the modal is closed.
    expect(screen.getByText('Keep elbows tucked')).toBeInTheDocument();
    expect(screen.getByText('Keep elbows tucked').closest('button')).toBeDisabled();
  });

  it('leaves Customize alone on the member\u2019s own screen', () => {
    asMemberOnTheirOwnScreen();
    renderExerciseDetail({ exercise: { ...exercise, note: 'Keep elbows tucked' } });

    expect(screen.getByRole('button', { name: 'Customize this exercise' })).toBeEnabled();
    expect(screen.getByText('Keep elbows tucked').closest('button')).toBeEnabled();
  });
});


// The stepper's own behaviour is covered in WeightRepsStepper.test.jsx and useHoldRepeat.test.jsx.
// What only this file can prove is the WIRING -- that the right expressions reach those props from
// a real ExerciseDetail, which nothing else asserts.
describe('ExerciseDetail stepper increments, bounds and hold', () => {
  const plank = { id: 1, name: 'Plank', trackingType: 'duration', tags: [], isFavorite: true, setupFields: [] };

  function holdFor(title, ms) {
    fireEvent.pointerDown(screen.getByTitle(title));
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(20, left);
      act(() => {
        vi.advanceTimersByTime(chunk);
      });
      left -= chunk;
    }
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
  }

  function mockPerson(person = {}) {
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [{ id: 7, name: 'Nate', ...person }],
      refreshPeople: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPerson();
    useUI.mockReturnValue({
      showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn(),
      holdTimers: {}, startHoldTimer: vi.fn(), stopHoldTimer: vi.fn(),
    });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it("steps the weight by this person's own configured increment", async () => {
    const draft = typedDraft({ weight: 135 });
    useAppState.mockReturnValue(draft);
    mockPerson({ weightIncrement: 10 });
    renderExerciseDetail();

    fireEvent.click(await screen.findByTitle('Increase Weight (lb)'));

    expect(draft.setDraft).toHaveBeenCalledWith(expect.objectContaining({ weight: 145, source: 'user' }));
  });

  it('defaults the weight step to 2.5 when the person row predates the preference', async () => {
    const draft = typedDraft({ weight: 135 });
    useAppState.mockReturnValue(draft);
    renderExerciseDetail();

    fireEvent.click(await screen.findByTitle('Increase Weight (lb)'));

    expect(draft.setDraft).toHaveBeenCalledWith(expect.objectContaining({ weight: 137.5, source: 'user' }));
  });

  // parseFloat happily returns -50 for a typed "-50", and LogSetRequest answers a negative weight
  // with a 400 -- which shouldRetryWrite treats as terminal, so an offline-queued set would be
  // DISCARDED rather than corrected. Clamping here is what keeps an unloggable number off the wire.
  it('clamps a typed negative weight to zero rather than letting it reach the wire', async () => {
    const draft = typedDraft({ weight: 135 });
    useAppState.mockReturnValue(draft);
    renderExerciseDetail();

    const input = await screen.findByLabelText('Weight (lb)');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-50' } });
    fireEvent.blur(input);

    expect(draft.setDraft).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, source: 'user' }));
  });

  it('marks the weight decrement as at its bound once the weight is zero', async () => {
    useAppState.mockReturnValue(typedDraft({ weight: 0 }));
    renderExerciseDetail();

    expect(await screen.findByTitle('Decrease Weight (lb)')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTitle('Increase Weight (lb)')).not.toHaveAttribute('aria-disabled');
  });

  describe('the Time control floor', () => {
    function durationDraft(durationSeconds) {
      return {
        weightDraft: 0, repsDraft: 8, durationDraft: durationSeconds, holdStartedAt: null,
        draftExerciseId: plank.id, draftSetCount: TYPED_AFTER_EVERYTHING, draftSource: 'user',
        setDraft: vi.fn(), setHoldStartedAt: vi.fn(), setRestTimer: vi.fn(),
      };
    }

    // The floor sits one step ABOVE blank, so a held finger can never land on an empty field that
    // then logs durationValue's 30-second default. It is deliberately not the same answer as the
    // dim, which this control never shows -- see ExerciseDetail's comment on holdFloor.
    it('refuses to repeat at the lowest real value, but still clears on a deliberate tap', async () => {
      const draft = durationDraft(5);
      useAppState.mockReturnValue(draft);
      renderExerciseDetail({ exercise: plank });
      await screen.findByTitle('Decrease Time');

      vi.useFakeTimers();
      holdFor('Decrease Time', 4000);
      expect(draft.setDraft).not.toHaveBeenCalled();
      vi.useRealTimers();

      // The escape hatch log-screen.md requires: blank stays reachable, just not by holding.
      fireEvent.click(screen.getByTitle('Decrease Time'));
      expect(draft.setDraft).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: null }));
    });

    // While a hold timer runs the field is a live readout of elapsed seconds, so it changes on its
    // own: neither of the hook stop conditions could ever fire and a held decrement would repeat
    // for as long as the finger stayed down, into a draft that Stop overwrites anyway.
    it('does not repeat at all while a hold timer is running', async () => {
      const draft = durationDraft(60);
      useAppState.mockReturnValue({ ...draft, holdStartedAt: Date.now() });
      useUI.mockReturnValue({
        showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn(),
        holdTimers: { 7: { elapsed: 42 } }, startHoldTimer: vi.fn(), stopHoldTimer: vi.fn(),
      });
      renderExerciseDetail({ exercise: plank });
      await screen.findByTitle('Decrease Time');

      vi.useFakeTimers();
      holdFor('Decrease Time', 4000);

      expect(draft.setDraft).not.toHaveBeenCalled();
    });
  });
});
