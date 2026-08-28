import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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
    return (
      <Link
        to="/app/billing"
        className="pressable plan-badge plan-badge--upgrade"
        aria-label="Go Pro"
      >
        Go Pro
      </Link>
    );
  }

  // Static, not a link: managing a subscription happens through the account menu's Plan & billing
  // item, and a Pro member has nothing to do here. It must not look tappable.
  return <span className="plan-badge plan-badge--pro">Pro</span>;
}
