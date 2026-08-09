import { useCallback, useState } from 'react';
import Spinner from './Spinner';

// The minimum time to keep showing the spinner once triggered, even if the underlying
// action resolves faster -- a sub-100ms flash reads as "did that even happen" almost as
// much as no feedback at all. Long enough to register consciously, short enough not to
// feel sluggish on an ordinary click.
const MIN_PENDING_MS = 400;

// Drop-in replacement for a raw <button> whose onClick performs an async action (an API
// call). While that promise is in flight the button disables itself and shows a spinner
// in place of its label, so a slow request reads as "working" instead of "did that click
// even register" -- which otherwise invites a second click and a duplicate request.
//
// `variant` and `size` map onto the .btn-* classes in index.css. They carry the
// hover/press/focus states an inline style object cannot express, so prefer them over
// passing colours through `style`. `style` still works and still wins, for the handful
// of one-off buttons that aren't part of the vocabulary yet.
//
//   primary       the one main action on a screen. At size="lg" it uses the brand
//                 accent; at sm/md it uses --color-accent-strong, because white on the
//                 brand orange is only 3.62:1 and needs AA Large to pass.
//   secondary     bordered surface. The default for anything that isn't THE action.
//   ghost         accent-coloured text, no chrome. Inline/tertiary actions.
//   danger        destructive, text only. danger-solid when it needs to be a real button.
//   dark          the intentionally-dark chip (routine progress, keypad Done).
export default function Button({
  onClick,
  style,
  children,
  disabled,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  ...rest
}) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(
    (event) => {
      if (!onClick) return;
      const result = onClick(event);
      if (result && typeof result.then === 'function') {
        setPending(true);
        const startedAt = Date.now();
        const stopPending = () => {
          const remaining = MIN_PENDING_MS - (Date.now() - startedAt);
          if (remaining > 0) setTimeout(() => setPending(false), remaining);
          else setPending(false);
        };
        // Swallow a rejection here -- callers (e.g. a mutation's onError) are responsible for
        // any user-facing error handling; this is only tracking pending state, not consuming
        // the result, and letting the rejection go unhandled would otherwise surface as a
        // console warning on top of whatever the caller already reported.
        result.finally(stopPending).catch(() => {});
      }
    },
    [onClick],
  );

  const classes = ['btn', `btn-${variant}`, `btn-${size}`, fullWidth && 'btn-full', 'pressable', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...rest} className={classes} onClick={handleClick} disabled={disabled || pending} style={style}>
      <span style={{ visibility: pending ? 'hidden' : 'visible', display: 'inherit', alignItems: 'inherit', gap: 'inherit' }}>
        {children}
      </span>
      {pending && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner color="currentColor" />
        </span>
      )}
    </button>
  );
}
