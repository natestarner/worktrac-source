import { useUI } from '../../context/UIContext';

const CONFETTI_SPECS = [
  { left: 6, color: '#E8590C', delay: 0.0 },
  { left: 16, color: '#15803D', delay: 0.08 },
  { left: 24, color: '#F2A93B', delay: 0.02 },
  { left: 33, color: '#E8590C', delay: 0.14 },
  { left: 41, color: '#15803D', delay: 0.06 },
  { left: 49, color: '#F2A93B', delay: 0.18 },
  { left: 57, color: '#E8590C', delay: 0.04 },
  { left: 65, color: '#15803D', delay: 0.16 },
  { left: 73, color: '#F2A93B', delay: 0.1 },
  { left: 81, color: '#E8590C', delay: 0.02 },
  { left: 12, color: '#F2A93B', delay: 0.2 },
  { left: 89, color: '#15803D', delay: 0.12 },
  { left: 45, color: '#E8590C', delay: 0.22 },
  { left: 60, color: '#F2A93B', delay: 0.24 },
];

export default function PRCelebration() {
  const { celebration, dismissCelebration } = useUI();
  if (!celebration) return null;

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
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--color-surface)',
          borderRadius: 24,
          padding: '40px 36px',
          width: 320,
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
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 4, position: 'relative', zIndex: 1 }}>
          New PR!
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 18, position: 'relative', zIndex: 1 }}>
          {celebration.exerciseName}
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            color: 'var(--color-accent)',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {celebration.est1rmText}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--color-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginTop: 4,
            position: 'relative',
            zIndex: 1,
          }}
        >
          Est. 1RM &middot; {celebration.setText}
        </div>
      </div>
    </div>
  );
}
