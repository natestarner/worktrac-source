import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
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
// THE MARK LEADS EVERY PHRASE THAT NAMES THE PRODUCT, on both plans. It used to appear only on the
// Pro pill, with Free getting an outline star -- the mark meaning "you have this", the star meaning
// "not yet". That reading is gone: the mark now means Huddle Pro the PRODUCT, so "Go Pro" reads as
// "go Huddle Pro" rather than as a generic upsell, and the same convention holds wherever Pro is
// named as a product (BillingTab's plan heading, ProCelebration, HistoryWindowModal's benefits
// block). What still signals possession is the PILL, not the glyph -- .plan-badge--pro's fixed
// bright identity colours against this one's transparent outline. See .claude/rules/billing.md.
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
    // No hairline override here, unlike the Pro pill below: .plan-badge--upgrade is
    // `background: transparent`, so it sits on the header's own theme-following ground and the
    // default --brand-mark-hairline is already correct in both schemes. Only a ground that stays
    // light in BOTH needs the explicit value.
    //
    // size 14 matches the Pro pill exactly, so the badge does not resize when a household upgrades
    // -- HuddleMark's height is round(size * 115/129), i.e. 12px at 14, the same box the outline
    // star occupied at size 12. HuddleMark is aria-hidden, so it never touches the "Go Pro"
    // accessible name below.
    return (
      <Link
        to="/app/billing"
        className="pressable plan-badge plan-badge--upgrade"
        aria-label="Go Pro"
      >
        <HuddleMark size={14} />
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
  // The same mark the Free pill now carries -- what changes between the two states is the pill, not
  // the glyph. It's already proven legible this small: public/icon.svg is the same four circles
  // rendered as the browser tab favicon. HuddleMark is aria-hidden and no text was split into
  // spans, so getByText('Pro', { exact: true }) is unmoved.
  //
  // hairline pinned to the light value: this pill's own background is a fixed light gradient
  // regardless of theme (see .plan-badge--pro's comment), so it is the one caller whose ground
  // does not follow the user's setting. HuddleMark's default --brand-mark-hairline goes
  // transparent in dark mode -- correct on a dark card, but here it would erase the outline
  // from a cream circle still sitting on a near-white pill and dissolve it.
  //
  // NOT wrapped in OfflineDisabledWrap, same reasoning as "Go Pro": this is a navigation, not a
  // write, and client-side routing works offline.
  return (
    <Link to="/app/billing" className="pressable plan-badge plan-badge--pro" aria-label="Pro">
      <HuddleMark size={14} hairline="#bdb6af" />
      Pro
    </Link>
  );
}
