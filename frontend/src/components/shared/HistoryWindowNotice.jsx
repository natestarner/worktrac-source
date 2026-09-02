import { useState } from 'react';
import ProUpsell from './ProUpsell';
import HistoryWindowModal from './HistoryWindowModal';
import { fullHistorySentence } from './historyWindowCopy';
import { IconHelp } from './icons';

// "There is more here than you can see." The one way History, PRs and Trends say so, so all three
// read in the same voice and none of them can drift into being pushier than the others.
//
// It COMPOSES ProUpsell rather than replacing it: the box, the tone and the "See Pro" link all
// still come from the single sanctioned upgrade prompt, and this only supplies the sentence and a
// way to ask why. ProUpsell keeps owning what an upgrade prompt looks like.
//
// THREE FAIL-CLOSED GATES, and any one of them silences this entirely:
//   1. plan !== 'FREE'      -- includes UNKNOWN, not just Pro. An auth snapshot written before
//                              billing shipped carries no plan, and showing a household that
//                              already pays a notice about what they cannot see is the worst
//                              outcome available here. Absence is the safe default, exactly as
//                              PlanBadge and ProUpsell already argue.
//   2. no server answer yet -- `historyWindow` is null until the request returns, and "not asked"
//                              must never render as "nothing hidden" or vice versa.
//   3. hiddenSessions === 0 -- nothing is hidden, so there is nothing to say. This is what keeps
//                              the app silent for the majority of Free households: someone in
//                              their first weeks sees no change on any tab.
//
// It is NOT a connectivity branch and must not become one. One code path in every mode; what varies
// while degraded is the CONTENT of the warmed cache, never the code. Offline with a warmed entry it
// renders identically; offline with no entry it renders nothing, the same as before the first
// answer arrives online. Nothing here belongs on resilience.md's register.
//
// Not dismissible, deliberately. For a long-tenured Free household the statement stays true, so it
// stays on screen -- which is why it is one line rather than a card. A dismiss would need a new
// persisted per-person field, with the hydrate-path hazard every one of those carries.
export default function HistoryWindowNotice({ plan, historyWindow, lead }) {
  const [explaining, setExplaining] = useState(false);

  const hidden = historyWindow?.hiddenSessions ?? 0;
  if (plan !== 'FREE' || !historyWindow || hidden === 0) return null;

  return (
    <div style={wrapStyle}>
      <ProUpsell
        plan={plan}
        action={
          // The info affordance lives ON the notice rather than as a separate badge in the app
          // chrome. A bare alert icon with no context is a puzzle the person has to solve, and
          // .app-chrome is one contiguous sticky box whose contents are load-bearing -- adding to
          // it has broken pointer handling across unrelated screens before.
          <button
            type="button"
            onClick={() => setExplaining(true)}
            aria-label="About your full history"
            className="pressable"
            style={infoButtonStyle}
          >
            <IconHelp size={18} />
          </button>
        }
      >
        {/* No mark here, deliberately. The convention is that it leads a phrase NAMING the product
            (the header pill, BillingTab's "Huddle Pro", the explainer's benefits block); this
            sentence names the person's own data, and its only "Pro" is inside the "See Pro" control
            label, where a four-colour glyph would be clutter. A mark on a sentence that does not say
            Pro is decoration, and decoration is how a quiet inline note starts reading as an ad --
            which is the one thing ProUpsell exists to prevent. */}
        {lead ? `${lead} ` : ''}
        {fullHistorySentence(hidden)}
      </ProUpsell>

      {explaining && (
        <HistoryWindowModal historyWindow={historyWindow} onClose={() => setExplaining(false)} />
      )}
    </div>
  );
}

const wrapStyle = { marginBottom: 'var(--space-4)' };

// --color-muted rather than the accent: the "See Pro" link sitting beside it is this box's call to
// action, and two competing accents in one small notice is how something calm starts reading as an
// advertisement. 44px square is the touch-target floor -- the app is used on an iPad mid-workout.
const infoButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  color: 'var(--color-muted)',
  cursor: 'pointer',
  minWidth: 44,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};
