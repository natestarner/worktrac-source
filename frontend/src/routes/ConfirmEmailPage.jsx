import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from '../components/auth/authStyles';
import Spinner from '../components/shared/Spinner';
import { rememberSignInMethod } from '../lib/lastSignInMethod';
import SigningInOverlay from '../components/auth/SigningInOverlay';
import { useSigningIn } from '../components/auth/useSigningIn';
import { codeFromInput } from '../utils/verificationCode';
import PasteCodeButton from '../components/auth/PasteCodeButton';

const RESEND_COOLDOWN_SECONDS = 60;

export default function ConfirmEmailPage() {
  const { confirmEmail, resendCode } = useAuth();
  const { deferOnboarding } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;
  // Set when this registration came from a marketing CTA that named a paid plan -- the homepage's
  // "Go Plus", or any CTA on the trainer page (see RegisterPage). 'PLUS' | 'PRO' | null. It changes
  // two things and nothing else: where they land, and whether the first-run welcome modal waits.
  // Both plans want the same two things, so this branches on "was a plan named at all", not on
  // which one -- the billing screen already carries a card for each.
  const wantsPlan = location.state?.wantsPlan ?? null;

  // "Use a different email": back to sign-up with what was typed, so a mistyped address is a
  // one-letter fix rather than a dead end. Before this the screen offered only Confirm and Resend,
  // and in the App Store app there is no browser Back button to find. Nothing needs undoing on the
  // server: no account exists until a code is confirmed, and the pending sign-up for the wrong
  // address simply expires (RegistrationService). The plan a marketing link named rides along in
  // the URL, which is where RegisterPage reads it.
  function startOver() {
    const plan = wantsPlan ? `?plan=${wantsPlan.toLowerCase()}` : '';
    navigate(`/register${plan}`, {
      replace: true,
      state: {
        startOver: {
          email,
          personName: location.state?.personName ?? '',
          accountName: location.state?.accountName ?? '',
        },
      },
    });
  }

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [error, setError] = useState('');
  // Tapping Confirm creates the account AND signs in, so it gets the same full-screen overlay an
  // Apple / Google sign-up's "Create" does, in the same words (SigningInOverlay.jsx).
  const { busy: submitting, begin, abandon: abandonAttempt } = useSigningIn();
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [justSent, setJustSent] = useState(false);
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Reloading loses router state -- this page can't function without knowing which email to
  // confirm, so send the user back to start registration again rather than show a dead form.
  if (!email) {
    return <Navigate to="/register" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setCodeError(true);
      return;
    }

    const attempt = begin();
    const { isCurrent } = attempt;
    try {
      await confirmEmail({ email, code: trimmedCode });
      rememberSignInMethod('password'); // a password registration, now signed in
      if (isCurrent()) await attempt.settled();
      // Even when abandoned from the overlay: the account exists and the session is live, so the
      // app is the only honest place to go (same rule as a late sign-in, SigningInOverlay.jsx).
      enterApp();
    } catch (err) {
      if (isCurrent()) await attempt.settled();
      if (!isCurrent()) return;
      setError(err.message || 'Could not confirm this code');
    } finally {
      attempt.end();
    }
  }

  // Where a just-confirmed registration lands.
  function enterApp() {
    if (wantsPlan) {
      // Defer BEFORE navigating: AppShell reads the gate in an effect keyed on the account, and
      // that effect runs as soon as the shell mounts. Setting it after the navigation would race
      // the modal it exists to suppress.
      deferOnboarding();
      // ?intent reports WHICH plan they named; the billing screen decides what to do with it.
      // Carried for both rather than only for Pro, so this page stays "say where they came from"
      // and the one screen that acts on it owns the behaviour. Today only 'pro' changes anything
      // there -- billing already leads with Plus, so a Plus arrival is already looking at what it
      // came for, while the Pro card is deliberately quieter and further down.
      navigate(`/app/billing?intent=${wantsPlan.toLowerCase()}`);
    } else {
      navigate('/app/log');
    }
  }

  // "Start over" on the overlay. The code may still be on its way; a late answer is handled as
  // handleSubmit says above.
  function abandon() {
    abandonAttempt();
    setError("That's taking longer than it should. Please try again.");
  }

  async function handleResend() {
    setError('');
    setJustSent(false);
    setResending(true);
    try {
      await resendCode({ email });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setJustSent(true);
      // The old code stops working the moment a new one is sent -- clear it so a leftover
      // stale code can't be submitted against the new one.
      setCode('');
      setCodeError(false);
      codeInputRef.current?.focus();
    } catch (err) {
      setError(err.message || 'Could not resend the code');
    } finally {
      setResending(false);
    }
  }

  return (
    <main
      // .code-screen: centred on a desktop, held at the top on a phone, so the keyboard opening
      // cannot move the box being typed into (index.css).
      className="code-screen"
      style={{
        minHeight: 'var(--viewport-min-height)',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        padding: 'var(--space-6)',
      }}
    >
      {submitting && (
        // A Pro arrival's account is an "Account", like RegisterPage's and SocialSignIn's wording.
        <SigningInOverlay
          label={wantsPlan === 'PRO' ? 'Creating your account…' : 'Creating your household…'}
          onAbandon={abandon}
        />
      )}
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-10) var(--space-8)',
          width: 380,
          maxWidth: '100%',
          boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
        }}
      >
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)', textAlign: 'center' }}>Check your email</h1>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          Enter the 6-digit code we sent to {email}. Not there? Check your spam or junk folder.
        </div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <label htmlFor="verification-code" style={labelStyle}>Verification code</label>
        <input
          autoFocus
          ref={codeInputRef}
          id="verification-code"
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          // No maxLength: it would cut a paste before the digits are pulled out (utils/verificationCode.js).
          placeholder="123456"
          value={code}
          onChange={(e) => {
            setCode(codeFromInput(e.target.value));
            if (codeError) setCodeError(false);
          }}
          className={`input ${codeError ? 'input-invalid' : ''}`}
          style={{
            ...inputStyle,
            textAlign: 'center',
            // Deliberate one-off, outside the type scale: a 6-digit code read back off a
            // phone is the whole job of this screen, and the tracking below only works at
            // a display size. --text-2xl would overflow the 380px card at this tracking.
            fontSize: 24,
            letterSpacing: '0.3em',
          }}
        />
        {codeError && <div style={fieldErrorStyle}>Enter the 6-digit code.</div>}
        <PasteCodeButton
          disabled={submitting}
          onCode={(pasted) => {
            setCode(pasted);
            setCodeError(false);
          }}
        />

        {/* No spinner of its own: the overlay covers the screen while this is disabled. */}
        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={primaryButtonStyle}>
          Confirm
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          style={{
            position: 'relative',
            width: '100%',
            minHeight: 44,
            padding: 'var(--space-3)',
            marginTop: 'var(--space-2)',
            background: 'transparent',
            color: resending || cooldown > 0 ? 'var(--color-muted)' : 'var(--color-accent-text)',
            border: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            cursor: resending || cooldown > 0 ? 'default' : 'pointer',
          }}
        >
          <span style={{ visibility: resending ? 'hidden' : undefined }}>
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </span>
          {resending && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="var(--color-muted)" />
            </span>
          )}
        </button>

        {/* Quieter than Resend: most people typed the address right. Muted text, not accent, so
            the two actions read as "the usual fix" and "the other one". */}
        <button
          type="button"
          onClick={startOver}
          disabled={submitting}
          className="pressable"
          style={{
            width: '100%',
            minHeight: 44,
            padding: 'var(--space-3)',
            background: 'transparent',
            color: 'var(--color-muted)',
            border: 'none',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          Use a different email
        </button>
        {justSent && cooldown > 0 && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center', marginTop: 'var(--space-2)' }}>
            New code sent.
          </div>
        )}
      </form>
    </main>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
  marginBottom: 'var(--space-1)',
};

const fieldErrorStyle = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-danger)',
  marginBottom: 'var(--space-4)',
};
