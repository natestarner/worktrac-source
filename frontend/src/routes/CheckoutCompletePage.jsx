import { Link, useSearchParams } from 'react-router-dom';

// Where Stripe's HOSTED checkout sends the browser -- the App Store app's US-storefront purchase
// (POST /api/billing/checkout-link). It opens in the phone's browser, not in the app, so all it can
// usefully do is tell the person to go back: the app confirms the payment itself when it returns to
// the foreground (hooks/useCheckoutResume.js), and the Stripe webhook applies it regardless.
//
// Public and stateless on purpose. This browser is usually signed out of Huddle, and nothing here
// needs a session: no request is made, so it can never fail, show a spinner, or ask anyone to sign
// in to see a receipt. The one link is for someone who did open it in a browser they ARE signed in
// to -- /app/billing?checkout= reconciles exactly as after a web checkout.
export default function CheckoutCompletePage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const cancelled = params.get('cancelled') === '1';

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={headingStyle}>{cancelled ? 'Checkout cancelled' : 'Payment complete'}</h1>
        <p style={bodyStyle}>
          {cancelled
            ? 'Nothing was charged. You can close this page and go back to the Huddle app.'
            : 'Thank you. Go back to the Huddle app — your plan updates there in a moment.'}
        </p>
        {!cancelled && sessionId && (
          <Link
            to={`/app/billing?checkout=${encodeURIComponent(sessionId)}`}
            className="pressable"
            style={linkStyle}
          >
            Open Huddle in this browser instead
          </Link>
        )}
      </div>
    </main>
  );
}

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-bg)',
  padding: 'var(--space-6)',
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-xl)',
  padding: 'var(--space-10) var(--space-8)',
  width: 380,
  maxWidth: '100%',
  boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
  textAlign: 'center',
};

const headingStyle = {
  fontSize: 'var(--text-2xl)',
  fontWeight: 'var(--weight-bold)',
  margin: '0 0 var(--space-2)',
};

const bodyStyle = {
  fontSize: 'var(--text-md)',
  color: 'var(--color-muted)',
  margin: '0 0 var(--space-5)',
};

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  color: 'var(--color-accent-text)',
  fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-sm)',
};
