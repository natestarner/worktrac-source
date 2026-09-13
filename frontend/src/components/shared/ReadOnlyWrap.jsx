import { cloneElement } from 'react';
import { useAccountAccess } from '../../hooks/useAccountAccess';

// Greys out a control that belongs to someone else's training data. The permission counterpart to
// OfflineDisabledWrap, and deliberately the same shape: clone the child in place rather than adding
// a wrapping DOM node, so it drops into an existing flex/grid layout without disturbing sizing.
//
// ── READ-ONLY BEATS OFFLINE, AND THE NESTING ENFORCES IT ──────────────────────────────────────
// A control a member can NEVER use must not tell them it "needs a connection" -- that is a lie
// that sends someone hunting for signal in a gym basement over something a better connection
// would never fix. So when both apply, this message wins.
//
// That precedence is structural, not a convention call sites have to remember. Nest it INSIDE:
//
//     <OfflineDisabledWrap message="Editing needs a connection.">
//       <ReadOnlyWrap personId={person.id}>
//         <button>Edit</button>
//       </ReadOnlyWrap>
//     </OfflineDisabledWrap>
//
// OfflineDisabledWrap clones its child with {disabled, title, style}. Its child here is this
// component, so those props arrive as `passthrough`:
//
//   writable          -> forwarded to the control unchanged, so offline behaves exactly as before
//   not writable      -> IGNORED, and this component's own message is applied instead
//
// Both orderings of the two states therefore resolve the same way, and getting the nesting
// backwards fails loudly (the offline props would land on a component that does not render them)
// rather than silently producing the wrong message.
//
// `personId` omitted, or null, means "not person-scoped" and never disables -- see
// useAccountAccess.canWritePerson for why the null case must stay permissive.
export default function ReadOnlyWrap({
  children,
  personId,
  message = 'You can only change your own workouts.',
  ...passthrough
}) {
  const { canWritePerson } = useAccountAccess();

  if (canWritePerson(personId)) {
    // Forward whatever OfflineDisabledWrap (or a plain parent) handed down, so this component is
    // invisible when it has nothing to say.
    return cloneElement(children, passthrough);
  }

  return cloneElement(children, {
    disabled: true,
    title: message,
    style: { ...(children.props.style || {}), opacity: 0.5, cursor: 'not-allowed' },
  });
}
