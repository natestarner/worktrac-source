import { useCallback, useState } from 'react';
import Spinner from './Spinner';

// Drop-in replacement for a raw <button> whose onClick performs an async action (an API
// call). While that promise is in flight the button disables itself and shows a spinner
// in place of its label, so a slow request reads as "working" instead of "did that click
// even register" -- which otherwise invites a second click and a duplicate request.
export default function Button({ onClick, style, children, disabled, ...rest }) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(
    (event) => {
      if (!onClick) return;
      const result = onClick(event);
      if (result && typeof result.then === 'function') {
        setPending(true);
        // Swallow a rejection here -- callers (e.g. a mutation's onError) are responsible for
        // any user-facing error handling; this is only tracking pending state, not consuming
        // the result, and letting the rejection go unhandled would otherwise surface as a
        // console warning on top of whatever the caller already reported.
        result.finally(() => setPending(false)).catch(() => {});
      }
    },
    [onClick],
  );

  return (
    <button {...rest} onClick={handleClick} disabled={disabled || pending} style={{ ...style, position: 'relative' }}>
      <span style={{ visibility: pending ? 'hidden' : 'visible' }}>{children}</span>
      {pending && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner color={typeof style?.color === 'string' ? style.color : 'currentColor'} />
        </span>
      )}
    </button>
  );
}
