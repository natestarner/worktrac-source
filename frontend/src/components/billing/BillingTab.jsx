import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getSubscription } from '../../api/billing';
import { queryKeys } from '../../api/queryKeys';
import { formatDate } from '../../utils/datetime';
import Button from '../shared/Button';
import PlanChooser from './PlanChooser';
import { PRO_BENEFITS } from './planCopy';

// The household's plan, and where an upgrade starts.
//
// Reads the plan from TWO places on purpose, and they answer different questions:
//   - `account.plan` (AuthContext, carried in the auth snapshot) is the DERIVED entitlement. It is
//     available on a cold offline boot with no network, so this screen always knows whether the
//     household is Pro.
//   - the `subscription` query carries the raw Stripe status, which is what decides the WORDING --
//     "renews" vs "ends" vs "we could not take your payment". It is allowed to be absent; the
//     screen degrades to the entitlement alone rather than blanking.
//
// That split is what keeps this screen honest while degraded: a household that cannot reach the
// server still sees the right plan, because the answer never depended on the request succeeding.
export default function BillingTab() {
  const { account } = useAuth();
  const { releaseOnboarding } = useUI();
  const navigate = useNavigate();
  const [interval, setInterval] = useState('YEAR');

  // Releasing on UNMOUNT covers every way the billing decision can resolve without a second
  // mechanism: paying and moving on, tapping "Start with Free", or simply leaving via a tab. All
  // three end with this screen gone, which is exactly the moment the first-run welcome modal
  // should be allowed to appear. Once checkout exists it also releases explicitly on a successful
  // reconcile, so the modal lands over the success screen rather than waiting for them to leave.
  //
  // A ref, not releaseOnboarding directly, so the cleanup does not re-run whenever UIContext's
  // value identity changes -- releasing mid-session would let the modal appear over this screen,
  // which is the thing being prevented.
  const releaseRef = useRef(releaseOnboarding);
  releaseRef.current = releaseOnboarding;
  useEffect(() => () => releaseRef.current(), []);

  const subscriptionQuery = useQuery({
    queryKey: queryKeys.subscription(),
    queryFn: getSubscription,
  });

  const plan = account?.plan;
  const subscription = subscriptionQuery.data;
  // The entitlement answer, in preference order: the snapshot (always present, works offline),
  // then the query. Never `false` merely because a request has not come back yet -- that would be
  // the "unreachable server downgrades you" failure the contract forbids.
  const isPro = plan === 'PRO' || subscription?.pro === true;

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      {isPro ? (
        <ProSummary subscription={subscription} />
      ) : (
        <FreeSummary interval={interval} onIntervalChange={setInterval} />
      )}
    </div>
  );
}

function ProSummary({ subscription }) {
  const cancelling = subscription?.cancelAtPeriodEnd === true;
  const periodEnd = subscription?.currentPeriodEnd;
  const comped = subscription?.comped === true;

  return (
    <>
      <div style={sectionLabelStyle}>Your plan</div>
      <div style={cardStyle}>
        <div style={planHeadingStyle}>Huddle Pro</div>
        <p style={mutedLineStyle}>
          {comped
            ? 'Your household has Pro on the house — with our thanks for being here early.'
            : renewalLine(cancelling, periodEnd)}
        </p>
      </div>

      <div style={sectionLabelStyle}>What Pro includes</div>
      <div style={cardStyle}>
        <BenefitList />
      </div>
    </>
  );
}

// "ends" vs "renews" is the whole reassurance: someone who has cancelled needs to see that they
// keep everything until the period they paid for actually runs out.
function renewalLine(cancelling, periodEnd) {
  if (!periodEnd) return 'Everything in Huddle, with no limits.';
  return cancelling
    ? `Pro until ${formatDate(periodEnd)} — you keep everything until then.`
    : `Renews ${formatDate(periodEnd)}.`;
}

function FreeSummary({ interval, onIntervalChange }) {
  return (
    <>
      <div style={sectionLabelStyle}>Your plan</div>
      <div style={cardStyle}>
        <div style={planHeadingStyle}>Free</div>
        <p style={mutedLineStyle}>
          Everyone in your household, unlimited workouts, and your full data export — always.
        </p>
      </div>

      <div style={sectionLabelStyle}>Upgrade to Pro</div>
      <div style={cardStyle}>
        <PlanChooser value={interval} onChange={onIntervalChange} />
        <BenefitList />
        {/* The one variant="primary" on this screen. The header's own control is a quiet
            outlined badge labelled "Go Pro" precisely so it does not compete with this, and so
            the two never share an accessible name. */}
        <Button variant="primary" size="lg" fullWidth disabled>
          Upgrade to Pro
        </Button>
        <p style={finetPrintStyle}>
          Cancel any time. Your workouts are never deleted — see Terms and Privacy.
        </p>
      </div>
    </>
  );
}

function BenefitList() {
  return (
    <ul style={benefitListStyle}>
      {PRO_BENEFITS.map((benefit) => (
        <li key={benefit.id} style={benefitItemStyle}>
          {benefit.label}
        </li>
      ))}
    </ul>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 0 var(--space-3) 0',
};

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 12,
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '20px',
  marginBottom: 24,
};

const planHeadingStyle = {
  fontSize: 'var(--text-xl)',
  fontWeight: 800,
  marginBottom: 'var(--space-2)',
};

const mutedLineStyle = {
  color: 'var(--color-muted)',
  margin: 0,
};

const benefitListStyle = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 var(--space-5) 0',
  display: 'grid',
  gap: 'var(--space-3)',
};

const benefitItemStyle = {
  color: 'var(--color-text)',
};

const finetPrintStyle = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  margin: 'var(--space-3) 0 0 0',
  textAlign: 'center',
};
