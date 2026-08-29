import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { IconStar } from '../shared/icons';
import HuddleMark from '../shared/HuddleMark';

// The household's plan, in the header, immediately left of the account menu.
//
// THREE states, and the third is the one that matters. An auth snapshot written before billing
// shipped carries no `plan` key, so it hydrates as undefined -- and showing "Go Pro" to someone who
// already pays is the worst bug this component can have. Unknown therefore renders NOTHING, and
// self-corrects on the next /me. Absence is the safe default in a way that guessing never is.
//
// It reads `account.plan` -- the DERIVED entitlement carried in the auth snapshot -- rather than
// the subscription query, so it renders correctly on a cold offline boot with no network at all.
// The cost is that it cannot distinguish PAST_DUE (which derives to PRO, deliberately: a household
// mid-dunning keeps access). Surfacing "your card failed, fix it" belongs with the Stripe work
// that makes the state reachable in the first place, and on the billing screen, which already
// reads the full status. Adding a network-dependent query here to say it sooner would trade a
// correct offline header for a marginally earlier warning.
//
// Labelled "Go Pro", NOT "Upgrade to Pro": a Free household standing on /app/billing has this
// control and that screen's primary button on screen together, and two controls sharing an
// accessible name make every Playwright getByRole(name: 'Upgrade to Pro') a strict-mode violation.
// The two strings are mutually non-containing, per frontend-core.md. ("Upgrade" alone would be
// worse -- it is a substring of "Upgrade to Pro" and would match both.)
//
// NOT wrapped in OfflineDisabledWrap, deliberately: this is a navigation, not a write.
// Client-side routing works offline, and the gate belongs on the checkout button it leads to.
// Greying this out would be the hand-rolled `disabled={!online}` the mechanism table forbids.
export default function PlanBadge() {
  const { account } = useAuth();
  const plan = account?.plan;

  if (plan !== 'FREE' && plan !== 'PRO') {
    return null;
  }

  if (plan === 'FREE') {
    // Outline star, echoing the same glyph the favourite toggle uses for "not yet" -- aspirational,
    // not achieved. IconStar is aria-hidden (icons.jsx), so it never touches the "Go Pro" name below.
    return (
      <Link
        to="/app/billing"
        className="pressable plan-badge plan-badge--upgrade"
        aria-label="Go Pro"
      >
        <IconStar size={12} />
        Go Pro
      </Link>
    );
  }

  // A link to /app/billing, same as "Go Pro" above -- it used to be a static span on the reasoning
  // that the account menu's "Plan & billing" item already goes there and a Pro member has nothing
  // to DO here. That held while this was quiet chrome; now that it's a deliberately prominent,
  // branded badge, a tap that goes nowhere reads as broken rather than as "nothing to do".
  // "Pro" is a substring of "Profile" (UserMenu's first item) and of "Upgrade to Pro"
  // (FreeSummary's button), but neither shares this control's ROLE -- Playwright/RTL role queries
  // filter by role before matching name, and a Free household never sees this link at all (Pro and
  // Free are mutually exclusive), so there is no state in which two same-named links coexist.
  //
  // The actual mark, not a generic icon -- paying for Huddle earns Huddle's own identity, not just
  // a colour swap on the same star. It's already proven legible this small: public/icon.svg is the
  // same four circles rendered as the browser tab favicon. HuddleMark is aria-hidden and no text
  // was split into spans, so getByText('Pro', { exact: true }) is unmoved.
  //
  // paleFill/paleStroke pinned to fixed light values: this pill's own background is a fixed light
  // colour regardless of theme (see .plan-badge--pro's comment), and the mark's pale circle
  // otherwise pulls dark mode's dark --color-surface/--color-border, tuned to blend into a DARK
  // card -- exactly wrong here.
  //
  // NOT wrapped in OfflineDisabledWrap, same reasoning as "Go Pro": this is a navigation, not a
  // write, and client-side routing works offline.
  return (
    <Link to="/app/billing" className="pressable plan-badge plan-badge--pro" aria-label="Pro">
      <HuddleMark size={14} paleFill="#ffffff" paleStroke="#e7e3dc" />
      Pro
    </Link>
  );
}
