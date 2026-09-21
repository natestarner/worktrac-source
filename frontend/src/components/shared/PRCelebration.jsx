import { useEffect, useRef } from 'react';
import { useUI } from '../../context/UIContext';
import { installFocusTrap } from '../../lib/focusTrap';
import PrBadge from './PrBadge';
import Button from './Button';

// The mark's own three warms -- orange, rust, amber -- not a generic confetti palette. The middle
// colour used to be #15803D, and it was the last cool hue left anywhere in the app's decorative
// surface; index.css's toast comment already makes the argument ('a saturated success green is the
// one hue in the palette that has nothing else to talk to'). All three read on the scrim, which is
// the same rgba(28,27,25,0.55) in both themes. PlusCelebration.jsx carries an identical copy on
// purpose -- keep them in step.
const CONFETTI_SPECS = [
  { left: 6, color: '#E8734A', delay: 0.0 },
  { left: 16, color: '#B5542D', delay: 0.08 },
  { left: 24, color: '#F2A65A', delay: 0.02 },
  { left: 33, color: '#E8734A', delay: 0.14 },
  { left: 41, color: '#B5542D', delay: 0.06 },
  { left: 49, color: '#F2A65A', delay: 0.18 },
  { left: 57, color: '#E8734A', delay: 0.04 },
  { left: 65, color: '#B5542D', delay: 0.16 },
  { left: 73, color: '#F2A65A', delay: 0.1 },
  { left: 81, color: '#E8734A', delay: 0.02 },
  { left: 12, color: '#F2A65A', delay: 0.2 },
  { left: 89, color: '#B5542D', delay: 0.12 },
  { left: 45, color: '#E8734A', delay: 0.22 },
  { left: 60, color: '#F2A65A', delay: 0.24 },
];

// ## This overlay PERSISTS until it is dismissed
//
// It used to clear itself after 2800ms, so a record set while everyone was talking -- which is the
// normal case around one iPad -- was simply missed. See UIContext#showCelebration.
//
// A persistent full-screen scrim is an app-bricking shape if it can ever fail to close, so there
// are four independent exits, and none of them depends on the other three:
//
//   1. the footer button          3. a scrim tap
//   2. Escape                     4. a reload (this state is in memory only, never persisted)
//
// It is still deliberately NOT a `Modal`: eight e2e specs dismiss it with a scrim click, and
// frontend-core.md names that as the reason. A Modal never closes on a backdrop tap, which is
// right for a half-built routine and wrong for a congratulation.
//
// ## Headline copy is pinned
//
// The headline stays the literal string "New PR!" whether one record fell or three. ~18 e2e specs
// assert page.getByText('New PR!'), and Playwright's substring match is case-insensitive but still
// includes the "!" -- so "2 new PRs!" would match none of them. The differentiation lives in the
// rows, which is where it belongs anyway.
//
// ## A first-ever set is a baseline, not a record
//
// The first set of any exercise beats nothing, so it technically takes every record at once.
// Claiming three PRs for it is how the celebration gets cheap -- with kids trying new lifts it
// would fire constantly. `firstTime` keeps the overlay and the haptic but drops the confetti and
// says so plainly.
export default function PRCelebration() {
  const { celebration, dismissCelebration } = useUI();
  const panelRef = useRef(null);
  const dismissRef = useRef(dismissCelebration);
  dismissRef.current = dismissCelebration;
  const open = !!celebration;

  // Escape, the focus trap, and moving focus INTO the panel. The trap only owns Tab/Shift+Tab
  // wraparound by design (lib/focusTrap.js), so Escape and autofocus are wired here -- the same
  // split Modal and ProductTour make. Reusing that module rather than forking a third copy of the
  // selector list is required by onboarding.md.
  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismissRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    const removeTrap = panel ? installFocusTrap(panel) : undefined;
    // Focus the dismiss button, so a keyboard user's first Enter closes it and a screen reader
    // lands inside the dialog rather than behind it.
    panel?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (removeTrap) removeTrap();
      // Restore focus to whatever raised it -- normally the "Log set" button, which is exactly
      // where a thumb wants to be for the next set.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [open]);

  if (!celebration) return null;

  const prs = celebration.prs || [];
  const firstTime = !!celebration.firstTime;

  return (
    <div
      onClick={dismissCelebration}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28,27,25,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        animation: 'celebScrimIn .2s ease',
        cursor: 'pointer',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pr-celebration-title"
        // ⚠️ NO stopPropagation HERE, deliberately. A tap anywhere -- scrim OR card -- dismisses,
        // which is both the behaviour this overlay has always had and what every existing caller
        // relies on: the e2e helpers and ~18 specs dismiss it with `getByText('New PR!').click()`,
        // and that text is the TITLE, inside this panel. Stopping the bubble here makes the card
        // inert and hangs every one of them on an intercepted click.
        //
        // It is also the right call on its own terms. A congratulation is not a form: there is
        // nothing to lose by dismissing it, so making the whole thing one big target is kinder
        // than demanding the button. (That argument is exactly why Modal points the other way and
        // never closes on a backdrop tap -- there, a stray thumb discards a half-built routine.)
        //
        // The footer button therefore fires dismissCelebration twice, once directly and once via
        // the bubble. That is harmless: it is an idempotent setState(null).
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--color-surface)',
          borderRadius: 24,
          padding: '40px 36px 28px',
          width: 320,
          maxWidth: '90vw',
          textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          animation: 'celebPop .45s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        {/* No confetti for a first-ever set -- see the header. */}
        {!firstTime &&
          CONFETTI_SPECS.map((c, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                top: -16,
                left: `${c.left}%`,
                width: 8,
                height: 14,
                background: c.color,
                borderRadius: 2,
                animation: `confettiFall 1.4s ease-in ${c.delay}s 1 both`,
              }}
            />
          ))}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--color-record-bg)',
            margin: '0 auto 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '14px solid transparent',
              borderRight: '14px solid transparent',
              borderBottom: '24px solid var(--color-accent)',
            }}
          />
        </div>
        <div
          id="pr-celebration-title"
          style={{
            fontSize: 24,
            fontWeight: 'var(--weight-bold)',
            letterSpacing: '-0.01em',
            marginBottom: 4,
            position: 'relative',
            zIndex: 1,
          }}
        >
          New PR!
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--color-muted)',
            marginBottom: 18,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {celebration.exerciseName}
        </div>

        {/* One row per record taken, in CELEBRATED_PR_TYPES precedence order (the caller sorts),
            so the same combination always reads the same way round. */}
        <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 'var(--space-3)' }}>
          {prs.map((pr) => (
            <div key={pr.type}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  marginBottom: 2,
                }}
              >
                {/* showLabel, unlike History's set pills. There the glyph sits beside the set it
                    marks, so context supplies the meaning; here two records are stacked as two
                    bare numbers ("185 lb" over "234.3 lb") and an icon alone does not say which
                    is which. Naming them is the difference between a celebration and a puzzle. */}
                <PrBadge type={pr.type} size={14} showLabel label={pr.label} />
                <span
                  style={{
                    fontSize: prs.length > 1 ? 26 : 34,
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-record-text)',
                  }}
                >
                  {pr.valueText}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {/* One string, decided by the caller (ExerciseDetail). This used to be a boolean
                    the overlay re-interpreted as the literal word "Bodyweight", which captioned
                    every hold that way -- weighted ones included. Deciding it there meant this
                    component had to know the difference between "has no est. 1RM" and "was
                    performed at bodyweight", and it only ever received the first. */}
                {pr.caption}
              </div>
            </div>
          ))}
        </div>

        {firstTime && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-muted)',
              marginTop: 'var(--space-3)',
              position: 'relative',
              zIndex: 1,
            }}
          >
            First time logging this one — now there’s something to beat.
          </div>
        )}

        {/* The one deliberate exit. Escape and a scrim tap do the same thing; this is the one a
            thumb finds. "Nice" rather than "Close"/"Done" because Modal reserves the accessible
            name "Close" for its header X and no other control in a dialog may contain that
            string -- and because a congratulation should not be dismissed by a filing verb. */}
        <Button
          variant="primary"
          fullWidth
          onClick={dismissCelebration}
          style={{ marginTop: 'var(--space-5)', position: 'relative', zIndex: 1 }}
        >
          Nice
        </Button>
      </div>
    </div>
  );
}
