import { useUI } from '../../context/UIContext';

// Tone -> colour. Previously this component was hardcoded to --color-success, so a
// failure ("Couldn't save that set") announced itself in the success colour.
const TONES = {
  success: { background: 'var(--color-success)', color: 'var(--color-accent-contrast)' },
  error: { background: 'var(--color-danger)', color: 'var(--color-accent-contrast)' },
  info: { background: 'var(--color-dark)', color: 'var(--color-accent-contrast)' },
};

export default function Toast() {
  const { toast } = useUI();
  if (!toast) return null;

  const tone = TONES[toast.tone] || TONES.success;

  return (
    <div
      // An error toast is the one tone that must interrupt a screen reader rather than
      // wait its turn; the others are confirmations of something the user just did.
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      style={{
        position: 'fixed',
        // Clears the home indicator on a standalone-display PWA.
        bottom: 'calc(var(--space-8) + env(safe-area-inset-bottom))',
        left: '50%',
        maxWidth: 'min(92vw, 480px)',
        textAlign: 'center',
        ...tone,
        padding: 'var(--space-3) var(--space-6)',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-semibold)',
        boxShadow: 'var(--shadow-3)',
        zIndex: 40,
        animation: 'toastIn var(--dur-slow) var(--ease-out)',
        transform: 'translateX(-50%)',
      }}
    >
      {toast.message}
    </div>
  );
}
