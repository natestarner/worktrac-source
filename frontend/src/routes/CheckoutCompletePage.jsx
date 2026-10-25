import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { appReturnUrl } from '../lib/native';

// Where Stripe's HOSTED checkout sends the browser -- the App Store app's US-storefront purchase
// (POST /api/billing/checkout-link). The URL is also a universal link, but iOS doesn't follow one
// that arrives as a redirect, so this usually opens in Safari. All it can usefully do is send the
// person back: "Return to the Huddle app" reopens it through its URL scheme (appReturnUrl), and the
// app confirms the payment itself when it returns to the foreground (hooks/useCheckoutResume.js).
// The Stripe webhook applies it regardless.
//
// Public and stateless on purpose. This browser is usually signed out of Huddle, and nothing here
// needs a session: no request is made, so it can never fail, show a spinner, or ask anyone to sign
// in to see a receipt. The second link is for someone who did open it in a browser they ARE signed
// in to -- /app/billing?checkout= reconciles exactly as after a web checkout.
export default function CheckoutCompletePage() {
  const [params] = useSearchParams();
  const { search } = useLocation();
  const sessionId = params.get('session_id');
  const cancelled = params.get('cancelled') === '1';
  // Null where no app claims the host (localhost, a preview): there is nothing to return to.
  const returnUrl = appReturnUrl(window.location.hostname, search);

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={headingStyle}>{cancelled ? 'Checkout cancelled' : 'Payment complete'}</h1>
        <p style={bodyStyle}>
          {cancelled
            ? 'Nothing was charged. You can close this page and go back to the Huddle app.'
            : 'Thank you. Go back to the Huddle app — your plan updates there in a moment.'}
        </p>
        {returnUrl && (
          <div style={returnRowStyle}>
            <a href={returnUrl} className="btn btn-primary btn-lg btn-full pressable">
              Return to the Huddle app
            </a>
          </div>
        )}
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
  minHeight: 'var(--viewport-min-height)',
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

const returnRowStyle = {
  marginBottom: 'var(--space-3)',
};

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  color: 'var(--color-accent-text)',
  fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-sm)',
};
