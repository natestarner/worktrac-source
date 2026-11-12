import { useEffect, useMemo, useRef, useState } from 'react';
import {
  availableSignInProviders,
  googleUsesRenderedButton,
  prepareSignIn,
  renderGoogleButton,
  signInWithProvider,
} from '../../lib/native';

const LABELS = { apple: 'Apple', google: 'Google', test: 'Test provider' };

/**
 * One button per provider this environment offers ("Continue with Apple", ...). Calls
 * `onToken(provider, { idToken, nonce, appleAuthorizationCode?, appleRedirectUri?, givenName? })`
 * with what the provider vouched for; a closed sheet is not an error. Renders nothing when no
 * provider is configured -- which is production until launch -- so the screens it sits on are
 * exactly what they were.
 *
 * `only` limits it to the providers named (re-confirming must use one ALREADY connected), and
 * `verb` is the button's first word ("Continue with", "Connect", "Confirm with").
 *
 * `size="large"` on the Log in and Register screens: the primary button's own classes (`.btn-lg`),
 * so it is exactly the size of "Log in" / "Create household" beside it. Apple's Human Interface Guidelines ask that Sign in with
 * Apple be no smaller than the screen's other ways to sign in, and App Review checks. Elsewhere
 * (Profile, confirm dialogs) the default 44px matches the buttons around it. Google's web button
 * is Google's own and tops out at 40px; that small difference is the accepted norm.
 *
 * A provider whose script can't load (offline, a content blocker) just drops out; nothing else on
 * the screen depends on it.
 */
export default function ProviderButtons({
  onToken, onError, disabled = false, only, verb = 'Continue with', size = 'default',
}) {
  const providers = useMemo(() => {
    const all = availableSignInProviders();
    return only ? all.filter((p) => only.includes(p)) : all;
  }, [only]);
  const [unavailable, setUnavailable] = useState([]);

  if (providers.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {providers
        .filter((p) => !unavailable.includes(p))
        .map((provider) =>
          provider === 'google' && googleUsesRenderedButton() ? (
            <GoogleRenderedButton
              key={provider}
              verb={verb}
              disabled={disabled}
              onToken={(token) => onToken('google', token)}
              onUnavailable={() => setUnavailable((list) => [...list, 'google'])}
            />
          ) : (
            <ProviderButton
              key={provider}
              provider={provider}
              verb={verb}
              size={size}
              disabled={disabled}
              onToken={onToken}
              onError={onError}
            />
          ),
        )}
    </div>
  );
}

function ProviderButton({ provider, verb, size, disabled, onToken, onError }) {
  const [busy, setBusy] = useState(false);

  // Ready the provider now, so the tap itself opens its sheet with nothing to wait for first
  // (iOS Safari blocks a popup opened after an await -- see socialSignIn.js#webApple). A failure
  // here is not shown: the click tries again and reports what it gets.
  useEffect(() => {
    prepareSignIn(provider).catch(() => {});
  }, [provider]);

  async function handleClick() {
    setBusy(true);
    try {
      const token = await signInWithProvider(provider);
      await onToken(provider, token);
    } catch (error) {
      if (!error?.cancelled) onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  // Large = the primary button's own classes (.btn .btn-lg .btn-full, the "Log in" / "Create
  // household" box), so the two can never drift apart: an inline min-height of 52 measured 52px
  // on lower while "Log in" is 58 (its padding and line height carry it past its own minimum).
  // Only the colours are set here, because inline size properties would override the class.
  const colors = provider === 'apple' ? appleColors : neutralColors;
  const large = size === 'large';
  return (
    <button
      type="button"
      className={large ? 'btn btn-lg btn-full pressable' : 'pressable'}
      onClick={handleClick}
      disabled={disabled || busy}
      style={large ? colors : { ...baseStyle, ...colors }}
    >
      {provider === 'apple' && <AppleLogo size={size === 'large' ? 20 : 16} />}
      {provider === 'google' && <GoogleLogo size={size === 'large' ? 20 : 16} />}
      <span>{`${verb} ${LABELS[provider]}`}</span>
    </button>
  );
}

// Google's own button, drawn by Google Identity Services (its branding rules want theirs on the
// web). It owns the click, so `disabled` is shown by dimming it and blocking pointer events.
function GoogleRenderedButton({ verb, disabled, onToken, onUnavailable }) {
  const ref = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!ref.current) return undefined;
    return renderGoogleButton(ref.current, {
      text: verb === 'Continue with' ? 'continue_with' : 'signin_with',
      onToken: (token) => onTokenRef.current(token),
      onError: () => onUnavailable(),
    });
    // Mounted once; a re-render must not redraw Google's iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      aria-label={`${verb} Google`}
      style={{
        display: 'flex',
        justifyContent: 'center',
        minHeight: 44,
        // Google's iframe document is light-only. When an iframe's color-scheme differs from the
        // page's, browsers paint an opaque canvas-colour backdrop behind it -- a white box around
        // the button in dark mode (seen in iOS Safari and Chromium). Matching its scheme keeps it
        // transparent; the button itself is unchanged.
        colorScheme: 'light',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    />
  );
}

const baseStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  minHeight: 44,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};

// Apple's Human Interface Guidelines fix this button's colours: black with white text, in both
// themes (a white variant exists for dark backgrounds, but black passes on ours in both). These are
// Apple's colours, not ours, which is why they are literals rather than tokens.
const appleColors = { background: '#000', color: '#fff', border: '1px solid #000' };

const neutralColors = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
};

/**
 * The provider's own mark, for anywhere a provider is NAMED rather than offered as a button
 * (Profile's "Sign in with" list). One copy of each logo, shared with the buttons above. The test
 * provider has none.
 */
export function ProviderLogo({ provider, size = 16 }) {
  if (provider === 'apple') return <AppleLogo size={size} />;
  if (provider === 'google') return <GoogleLogo size={size} />;
  return null;
}

function AppleLogo({ size = 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

// Google's four-colour "G", which its branding rules require on a custom Google button (the app's).
function GoogleLogo({ size = 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
