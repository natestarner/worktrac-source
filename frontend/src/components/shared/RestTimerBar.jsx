import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { formatRestTime } from '../../utils/datetime';

export default function RestTimerBar() {
  const { activePersonId } = useAppState();
  const { restTimers, addRestTime, skipRestTimer } = useUI();
  const [enabled] = useRestTimerPreference(activePersonId);
  const restTimer = restTimers[activePersonId];
  if (!enabled || !restTimer) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--color-dark)',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 18,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-faint)' }}>Rest</span>
      <span style={{ fontSize: 20, fontWeight: 800, minWidth: 44 }}>{formatRestTime(restTimer.secondsLeft)}</span>
      <button
        onClick={() => addRestTime(activePersonId, 30)}
        style={{
          background: 'rgba(255,255,255,0.12)',
          border: 'none',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          padding: '8px 12px',
          borderRadius: 999,
          cursor: 'pointer',
        }}
      >
        +30s
      </button>
      <button
        onClick={() => skipRestTimer(activePersonId)}
        style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        Skip
      </button>
    </div>
  );
}
