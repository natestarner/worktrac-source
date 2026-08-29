import HuddleMark from '../shared/HuddleMark';

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
  { left: 6, color: '#D4673E', delay: 0.0 },
  { left: 16, color: '#15803D', delay: 0.08 },
  { left: 24, color: '#F2A65A', delay: 0.02 },
  { left: 33, color: '#D4673E', delay: 0.14 },
  { left: 41, color: '#15803D', delay: 0.06 },
  { left: 49, color: '#F2A65A', delay: 0.18 },
  { left: 57, color: '#D4673E', delay: 0.04 },
  { left: 65, color: '#15803D', delay: 0.16 },
  { left: 73, color: '#F2A65A', delay: 0.1 },
  { left: 81, color: '#D4673E', delay: 0.02 },
  { left: 12, color: '#F2A65A', delay: 0.2 },
  { left: 89, color: '#15803D', delay: 0.12 },
  { left: 45, color: '#D4673E', delay: 0.22 },
  { left: 60, color: '#F2A65A', delay: 0.24 },
];

export default function ProCelebration({ onDismiss }) {
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
          {/* The actual mark, not a generic icon -- same reasoning as the header's Pro pill
              (PlanBadge.jsx): paying earns Huddle's own identity. No paleFill/paleStroke override
              needed here, unlike that pill -- this circle is var(--color-pr-bg), a normal
              theme-aware surface (not a fixed-light one), so HuddleMark's default pale circle
              already blends the same way it does on BillingTab's own ProSummary card. */}
          <HuddleMark size={40} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 8, position: 'relative', zIndex: 1 }}>
          Welcome to Huddle Pro
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-muted)', lineHeight: 1.5, position: 'relative', zIndex: 1 }}>
          Your whole history, every record, and import are unlocked. Thanks for keeping Huddle going.
        </div>
      </div>
    </div>
  );
}
