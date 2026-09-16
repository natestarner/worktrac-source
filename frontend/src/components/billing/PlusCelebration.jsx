import HuddleMark from '../shared/HuddleMark';
import { PLANS, planCopy } from './planCopy';

// The moment a checkout actually lands, mirroring PRCelebration's shape (shared/PRCelebration.jsx)
// almost exactly -- same scrim, same confetti, same pop-in -- rather than inventing a second
// celebration mechanism. Reuses the SAME keyframes (celebScrimIn/celebPop/confettiFall) already in
// index.css, referenced inline the way PRCelebration does, so this file introduces no new CSS.
//
// Deliberately NOT a Modal, for the same reason PRCelebration isn't one: this is a transient,
// one-shot celebration rather than a dialog with a job to finish, so a scrim tap is the one and
// only dismissal -- no X, no focus trap, no Escape handling to get wrong.
//
// Lives in components/billing/ rather than shared/ because, unlike the PR celebration (triggerable
// from anywhere a set gets logged), this has exactly one call site: BillingTab's checkout-reconcile
// effect. That's local, ephemeral UI state, not the kind of cross-screen state UIContext exists for.
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

// ⚠️ TAKES THE TIER. It said "Welcome to Huddle Plus" as a literal, under a line about history,
// records and import -- so a trainer finishing a Pro checkout was congratulated on unlocking four
// things they already had and none of the four they had just bought. Both strings now come from
// planCopy, the same map the billing screen and the header pill read.
//
// Unknown or absent tier falls back to Plus's wording rather than rendering nothing: this is a
// transient congratulation over a payment that HAS succeeded, and showing no celebration at all
// after a successful checkout reads as "did that work?" -- the opposite failure from the badge's,
// where silence is the safe answer because it self-corrects on the next /me.
//
// ⚠️ THE GUARD ASKS FOR THE COPY, NOT FOR A RECOGNISED TIER. `planCopy('FREE')` returns a
// real entry whose `welcome` is null -- nobody celebrates arriving at Free -- so a `?? PLANS.PLUS`
// fallback keyed on the ENTRY slipped straight past it and rendered "Welcome to Huddle Free" under
// an empty line. That is reachable: the auth snapshot still says FREE for the moment between a
// checkout landing and /me catching up, and it stays FREE indefinitely whenever the webhook rather
// than the reconcile is what applies the purchase. Caught by billing.spec.ts, which drives the real
// redirect; no unit test had the timing to see it.
export default function PlusCelebration({ plan, onDismiss }) {
  const named = planCopy(plan);
  const copy = named?.welcome ? named : PLANS.PLUS;

  return (
    <div
      onClick={onDismiss}
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
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--color-surface)',
          borderRadius: 24,
          padding: '40px 36px',
          width: 340,
          maxWidth: '90vw',
          textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          animation: 'celebPop .45s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        {CONFETTI_SPECS.map((c, i) => (
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
            background: 'var(--color-pr-bg)',
            margin: '0 auto 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* The actual mark, not a generic icon -- same reasoning as the header's Plus pill
              (PlanBadge.jsx): paying earns Huddle's own identity. No hairline override needed
              here, unlike that pill -- this sits on var(--color-pr-bg), a normal theme-aware
              surface rather than a fixed-light one, so the default --brand-mark-hairline is
              already right in both schemes. */}
          <HuddleMark size={40} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 'var(--weight-bold)', letterSpacing: '-0.01em', marginBottom: 8, position: 'relative', zIndex: 1 }}>
          Welcome to Huddle {copy.name}
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-muted)', lineHeight: 1.5, position: 'relative', zIndex: 1 }}>
          {copy.welcome}
        </div>
      </div>
    </div>
  );
}
