import { useUI } from '../../context/UIContext';

// Tone -> colour.
//
// Success and info are both the neutral toast surface, not green. The saturated success
// green was the one hue in the palette with nothing else to talk to, and next to the
// terracotta it read as borrowed from another app -- and a confirmation doesn't need a
// colour to carry its meaning, the message does. Errors are the exception: there, colour
// is doing real work, so they keep --color-danger.
const TONES = {
  success: { background: 'var(--color-toast-bg)', color: 'var(--color-toast-text)' },
  info: { background: 'var(--color-toast-bg)', color: 'var(--color-toast-text)' },
  // Not --color-danger + white: in dark mode that token is a light salmon tuned for text on a
  // dark ground, so white on it lands at 2.95:1. The error tokens flip the label per theme.
  error: { background: 'var(--color-toast-error-bg)', color: 'var(--color-toast-error-text)' },
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
