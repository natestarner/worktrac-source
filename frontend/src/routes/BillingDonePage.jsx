import { Link } from 'react-router-dom';

// Where Stripe's Customer Portal sends its "Return to Huddle" for the App Store app
// (POST /api/billing/portal-session?returnTo=app). The app shows the portal in an in-app browser
// sheet, which has its own browser storage, so loading /app/billing there would be a signed-out web
// app inside the sheet. All this page can usefully do is say how to close it: the sheet's Done
// button returns to the app, which refreshes the plan the moment the sheet closes (BillingTab's
// refreshAfterPortal).
//
// Public and stateless, like CheckoutCompletePage: no request, so it can never fail or ask anyone
// to sign in. Not claimed by the app in apple-app-site-association, deliberately -- it must stay
// in the sheet. The link is for the odd visit from a browser that IS signed in.
export default function BillingDonePage() {
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={headingStyle}>All done</h1>
        <p style={bodyStyle}>Tap Done to go back to Huddle. Any change you made shows there in a moment.</p>
        <Link to="/app/billing" className="pressable" style={linkStyle}>
          Open Huddle in this browser instead
        </Link>
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

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  color: 'var(--color-accent-text)',
  fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-sm)',
};
