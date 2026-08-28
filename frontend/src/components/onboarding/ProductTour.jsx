import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { installFocusTrap } from '../../lib/focusTrap';
import { lockBodyScroll } from '../../lib/bodyScrollLock';
import { TOUR_STEPS } from './tourSteps';
import { pickTourExercise } from './tourExercise';
import { useTourAnchor } from './useTourAnchor';
import { computeTourFrame, VIEWPORT_MARGIN } from './tourPosition';
import Button from '../shared/Button';

// The driven-spotlight tour: it navigates the real app to each step's real screen, so every
// anchor is genuinely on screen, then puts everything back. Mounted by AppShell only while
// `tour` (UIContext) is truthy -- `{tour && <ProductTour/>}`, not a self-guarding `if (!tour)
// return null` the way ConfirmDialog/PRCelebration do -- specifically so its two catalog hooks
// (below) exist only for the life of an actual tour, rather than becoming a permanent observer
// that History/PRs/Trends never asked for.
//
// Runtime state (`tour.stepIndex`) lives in UIContext beside toast/confirmDialog/celebration --
// the three "genuinely global one-shot notifications" frontend-core.md names as the exceptions to
// per-person state. The tour is structurally identical: one overlay at a time, in memory, gone on
// reload, and it belongs to the ACCOUNT rather than to whichever person happens to be active --
// switching people mid-tour must not fork or duplicate it.
//
// A deploy killing the tour mid-run is accepted, not guarded against: AppShell's section-switch
// effect calls tryForceUpdate on the tour's own navigation to /app/routines, same as any ordinary
// tab switch, and the tour performs no writes for that guard to protect anyway. The flag that
// gates the WELCOME MODAL was already cleared at "Show me around", so the tour is simply lost --
// the alternative (persisting stepIndex under a worktrac- key) can resurrect a stale tour on a
// later, unrelated load, which is worse than losing a one-off.
export default function ProductTour() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tour, nextTourStep, prevTourStep, endTour } = useUI();
  const {
    activePersonId,
    selectedExerciseId,
    exerciseSearch,
    weightDraft,
    repsDraft,
    durationDraft,
    draftExerciseId,
    draftSetCount,
    draftSource,
    selectExercise,
    backToPicker,
    setExerciseSearch,
    setDraft,
  } = useAppState();

  // Mounted HERE, not in AppShell -- see the header comment. A brand-new household with an empty
  // catalog degrades to pickTourExercise returning null, which in turn means steps 5-7 simply
  // never find their anchor (see the missing-anchor degrade below) rather than throwing.
  const { exercises: catalog } = useExercises();
  const { exercises: personExercises } = usePersonExercises(activePersonId);
  const tourExerciseId = useMemo(
    () => pickTourExercise({ personExercises, catalog })?.id ?? null,
    [personExercises, catalog],
  );

  const stepIndex = tour.stepIndex;
  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[TOUR_STEPS.length - 1];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex >= TOUR_STEPS.length - 1;

  // --- Snapshot, captured once on first render -----------------------------------------------
  // A plain lazy-ref pattern (guarded write, not an effect): this needs whatever the app looked
  // like at the exact instant "Show me around"/"Take the tour" was tapped, which is precisely
  // what THIS render's hook values already are. startTour() takes no arguments as a result --
  // neither entry point needs to know what the tour is about to disturb.
  const snapshotRef = useRef(null);
  if (snapshotRef.current === null) {
    snapshotRef.current = {
      pathname: location.pathname,
      selectedExerciseId,
      exerciseSearch,
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      weightDraft,
      repsDraft,
      durationDraft,
      draftExerciseId,
      draftSetCount,
      draftSource,
    };
  }

  // Read fresh inside effects without listing as a dependency -- see AppShell's own
  // prevPersonIdRef/prevPathRef for the identical pattern and its reasoning.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // --- Arrange this step's screen, declaratively ---------------------------------------------
  // Applied by one effect keyed on the step (and once tourExerciseId resolves, in case the
  // catalog was still loading when a step needing it was already current). Declarative rather
  // than an imperative switch is what makes stepping BACKWARDS re-arrange for free -- there is no
  // separate "undo" path to keep in sync with the forward one.
  useEffect(() => {
    if (pathnameRef.current !== step.screen.route) navigate(step.screen.route);
    if (step.screen.exercise === 'none') {
      backToPicker();
    } else if (step.screen.exercise === 'open' && tourExerciseId != null) {
      selectExercise(tourExerciseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tourExerciseId]);

  // --- Wait for the anchor ---------------------------------------------------------------------
  const { element: targetElement, status: anchorStatus } = useTourAnchor(step.anchor);
  const targetRef = useRef(targetElement);
  const anchorStatusRef = useRef(anchorStatus);
  targetRef.current = targetElement;
  anchorStatusRef.current = anchorStatus;

  // --- Measure and place -----------------------------------------------------------------------
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  // Sane default so the card is always visible and usable even before (or absent) a real
  // measurement -- jsdom computes no layout at all, so unit tests never get past the bail-out
  // below, and this is what keeps them able to find and click the card's own controls anyway.
  // Real placement is e2e/tests/onboarding-tour.spec.ts's job; see tourPosition.test.js for the
  // arithmetic itself.
  const [frame, setFrame] = useState({ spotlight: null, card: { top: 24, left: 24 }, placement: 'centered' });

  const measureAndPlace = useCallback(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    const layerEl = layerRef.current;
    const bottomInset = layerEl ? parseFloat(getComputedStyle(layerEl).paddingBottom) || 0 : 0;
    // .app-chrome is sticky at top:0, so its OWN bottom edge is exactly the height it reserves --
    // that height varies with household size, orientation and the landscape padding block, so it
    // has to be measured, not guessed.
    const chromeEl = document.querySelector('.app-chrome');
    const topInset = chromeEl ? chromeEl.getBoundingClientRect().bottom : 0;
    // window.visualViewport when present: on iOS Safari the collapsing URL bar means innerHeight
    // is the LAYOUT viewport, not what is actually visible, and this overlay's chrome (fixed
    // position) sits according to the visual one.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const viewport = vv
      ? { width: vv.width, height: vv.height }
      : { width: window.innerWidth, height: window.innerHeight };

    // Cap the card to the USABLE band -- between the sticky chrome and the bottom bar -- before
    // measuring it, so a step whose copy runs long on a short landscape phone scrolls its own
    // content instead of the card overflowing a viewport no placement could ever fit it into.
    // Same call Modal.jsx makes with its own maxHeight/overflowY, applied here imperatively
    // (rather than through style props) so the getBoundingClientRect() below already reflects it.
    // Floored rather than left to go negative on an absurdly short viewport.
    const usableHeight = viewport.height - bottomInset - topInset;
    cardEl.style.maxHeight = `${Math.max(usableHeight - VIEWPORT_MARGIN * 2, 120)}px`;

    const cardRect = cardEl.getBoundingClientRect();
    // jsdom computes no layout, so this is always 0 there -- leave the current frame alone rather
    // than "correcting" a card whose real size is unknown (see ChartHelp.jsx's identical guard).
    if (cardRect.width === 0) return;

    let target = null;
    if (anchorStatusRef.current === 'found' && targetRef.current) {
      let rect = targetRef.current.getBoundingClientRect();
      const usableBottom = viewport.height - bottomInset;
      const fullyVisible =
        rect.top >= topInset && rect.bottom <= usableBottom && rect.left >= 0 && rect.right <= viewport.width;
      // Don't scroll when the anchor is already fully visible -- on a desktop where everything
      // fits, scrollIntoView yanks the page for nothing.
      if (!fullyVisible && targetRef.current.scrollIntoView) {
        // 'auto', not 'smooth': an instantaneous scroll has no animation to race, so the
        // re-measurement on the next line is already correct.
        targetRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
        rect = targetRef.current.getBoundingClientRect();
      }
      target = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }

    setFrame(
      computeTourFrame({
        target,
        card: { width: cardRect.width, height: cardRect.height },
        viewport,
        topInset,
        bottomInset,
      }),
    );
  }, []);

  // The primary placement pass for this step: synchronous, before paint, so there is no frame at
  // the previous step's position (or the default fallback above) to flash.
  useLayoutEffect(() => {
    measureAndPlace();
  }, [step, anchorStatus, targetElement, measureAndPlace]);

  // Ongoing responsiveness. Coalesced through one rAF: several of these can fire in the same
  // burst (a resize firing alongside a visualViewport resize, say), and only the LAST one before
  // the next paint needs to actually run the measurement.
  useEffect(() => {
    let rafId = null;
    function scheduleRemeasure() {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measureAndPlace();
      });
    }

    window.addEventListener('resize', scheduleRemeasure);
    window.addEventListener('orientationchange', scheduleRemeasure);
    // Capture phase: a scroll inside .log-sets-col (which gets its own scroll container at the
    // middle layout) must still trigger a remeasure, and capture is what reaches it before the
    // event would otherwise stop at a non-bubbling scroll target.
    document.addEventListener('scroll', scheduleRemeasure, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleRemeasure);
    vv?.addEventListener('scroll', scheduleRemeasure);

    // The non-obvious one: ExerciseDetail's summary cards swap from skeletons to real content,
    // moving steps 5 and 6's anchors WITHOUT resizing them -- a plain resize/scroll listener
    // would miss that entirely.
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleRemeasure);
      observer.observe(document.body);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleRemeasure);
      window.removeEventListener('orientationchange', scheduleRemeasure);
      document.removeEventListener('scroll', scheduleRemeasure, true);
      vv?.removeEventListener('resize', scheduleRemeasure);
      vv?.removeEventListener('scroll', scheduleRemeasure);
      observer?.disconnect();
    };
  }, [measureAndPlace]);

  // --- Restore, in one handler ------------------------------------------------------------------
  // Used by Escape, "Skip tour" AND "Got it" alike -- by the time step 9 is reached the app is
  // already arranged back on the Log picker as that step's OWN screen declaration, so "finishing"
  // and "skipping" both mean the same thing: put back whatever the tour disturbed to get here.
  const finishOrSkip = useCallback(() => {
    const snap = snapshotRef.current;
    // The exercise restore and setDraft below are dispatched TOGETHER (same synchronous call, same
    // React batch) so that if ExerciseDetail remounts as a result, draftSource: 'user' is already
    // in context on its first render and its prefill effect early-returns instead of stomping the
    // restored value -- see docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md.
    if (snap.selectedExerciseId != null) selectExercise(snap.selectedExerciseId);
    else backToPicker();
    // exerciseSearch is not politeness: SELECT_EXERCISE clears it as a side effect
    // (AppStateContext.jsx), so restoring the exercise above may have just wiped a half-typed
    // search -- put it back explicitly, after, rather than relying on order-of-dispatch luck.
    setExerciseSearch(snap.exerciseSearch);
    setDraft({
      exerciseId: snap.draftExerciseId,
      weight: snap.weightDraft,
      reps: snap.repsDraft,
      durationSeconds: snap.durationDraft,
      setCount: snap.draftSetCount,
      source: snap.draftSource,
    });
    if (pathnameRef.current !== snap.pathname) navigate(snap.pathname);
    // lastTab needs no handling of its own -- AppShell rewrites it on this very navigation.
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, snap.scrollY);
    endTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Focus, the trap, and body scroll -----------------------------------------------------
  // Focus moves to the card on mount AND on every step change -- that focus move IS the
  // announcement to a screen-reader user, so there is no separate aria-live region.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Read through a ref, not listed as an effect dependency -- same reasoning as Modal's
  // onCloseRef: finishOrSkip's identity is stable here (empty dep array below), but the ref
  // pattern is what keeps the escape listener from ever needing to reinstall.
  const finishOrSkipRef = useRef(finishOrSkip);
  finishOrSkipRef.current = finishOrSkip;

  // Installed once for the tour's whole lifetime, exactly like Modal -- both extracted from the
  // same lib/focusTrap.js and lib/bodyScrollLock.js so this can never drift from what Modal does.
  useEffect(() => {
    const layerEl = layerRef.current;
    if (!layerEl) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finishOrSkipRef.current();
      }
    }
    // Arrow keys are deliberately NOT wired: WeightRepsStepper, DurationWheel and the tabs strip
    // all claim arrows already, and binding them here would teach a shortcut that dies with the
    // tour the moment it ends.
    layerEl.addEventListener('keydown', onKeyDown);
    const uninstallFocusTrap = installFocusTrap(layerEl);
    const unlockBodyScroll = lockBodyScroll();
    return () => {
      layerEl.removeEventListener('keydown', onKeyDown);
      uninstallFocusTrap();
      unlockBodyScroll();
    };
    // Mount/unmount only, same reasoning as Modal.jsx's identical effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleId = `tour-step-title-${step.id}`;
  const bodyId = `tour-step-body-${step.id}`;

  return createPortal(
    <div
      ref={layerRef}
      className="tour-layer"
      // No onClick: a stray thumb on the scrim does nothing, same as Modal's inert backdrop, for
      // the same one-handed-iPad reason.
    >
      {frame.spotlight && (
        <div
          className="tour-spotlight"
          style={{
            top: frame.spotlight.top,
            left: frame.spotlight.left,
            width: frame.spotlight.width,
            height: frame.spotlight.height,
          }}
        />
      )}
      {/* key={step.id} restarts the card's own fadeIn cross-fade on every step change, and gives
          each step's focus() call a genuinely fresh node to land on. */}
      <div
        key={step.id}
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={{ top: frame.card.top, left: frame.card.left }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)',
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-muted)' }}>
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <Button onClick={finishOrSkip} variant="ghost" size="sm">
            Skip tour
          </Button>
        </div>

        <h2
          id={titleId}
          style={{
            margin: '0 0 var(--space-2)',
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--color-text)',
          }}
        >
          {step.title}
        </h2>
        <p
          id={bodyId}
          style={{
            margin: '0 0 var(--space-5)',
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-normal)',
            color: 'var(--color-muted)',
          }}
        >
          {step.body}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {!isFirstStep && (
            <Button onClick={prevTourStep} variant="secondary" style={{ flex: 1 }}>
              Previous
            </Button>
          )}
          <Button onClick={isLastStep ? finishOrSkip : nextTourStep} variant="primary" style={{ flex: 1 }}>
            {isLastStep ? 'Got it' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
