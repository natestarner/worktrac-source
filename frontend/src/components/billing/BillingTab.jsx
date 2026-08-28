import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  reconcileCheckout,
} from '../../api/billing';
import { queryKeys } from '../../api/queryKeys';
import { formatDate } from '../../utils/datetime';
import Button from '../shared/Button';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import PlanChooser from './PlanChooser';
import EmbeddedCheckout from './EmbeddedCheckout';
import { PRO_BENEFITS } from './planCopy';

// The household's plan, and where an upgrade happens.
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
  const { account, refreshPeople } = useAuth();
  const { releaseOnboarding, showToast } = useUI();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState('YEAR');
  const [checkout, setCheckout] = useState(null);

  // `online` is deliberately not destructured: OfflineDisabledWrap reads useOnlineStatus
  // itself, and a second copy of that answer here is the kind of duplicate the
  // mechanism table exists to prevent.
  const { pending, run } = useGatedMutation();

  // NOTE: leaving this screen is NOT what releases the deferral -- AppShell does that, keyed on the
  // route. An unmount cleanup here was the obvious implementation and it is wrong: StrictMode
  // double-invokes effects (mount -> cleanup -> mount), so the cleanup fired immediately while the
  // billing screen was still on screen, and the welcome modal appeared over it. Unit tests missed
  // it because RTL does not wrap in StrictMode; the e2e caught it as an "intercepts pointer
  // events" failure, which is this codebase's usual signature for an unexpected overlay.
  //
  // What DOES belong here is the release after a successful payment (below), because the modal
  // should land over the success screen rather than waiting for the person to navigate away.
  const releaseRef = useRef(releaseOnboarding);
  releaseRef.current = releaseOnboarding;

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

  // Stripe returns the browser to /app/billing?checkout=cs_... The backend reads that session
  // directly and applies it, so the upgrade is visible immediately rather than waiting on a
  // webhook -- which is what avoids the classic "I paid and I'm still on Free" ticket.
  const checkoutParam = searchParams.get('checkout');
  const reconciledRef = useRef(null);
  useEffect(() => {
    if (!checkoutParam || reconciledRef.current === checkoutParam) return;
    reconciledRef.current = checkoutParam;

    let cancelled = false;
    (async () => {
      try {
        await reconcileCheckout(checkoutParam);
        if (cancelled) return;
        // /me is what carries the derived plan into the auth snapshot, so the header badge and
        // every other consumer update from the same source rather than a second copy of the truth.
        await refreshPeople();
        queryClient.invalidateQueries({ queryKey: queryKeys.subscription() });
        // The welcome modal may now appear over the success state, which is the intended order:
        // the tour comes AFTER the money decision.
        releaseRef.current();
      } catch {
        // The webhook is the backstop, so a failed reconcile is a delay rather than a lost payment.
        // Saying so beats a spinner that resolves into nothing.
        if (!cancelled) {
          showToast('Payment received — your plan will update shortly.', { tone: 'info' });
        }
      } finally {
        if (!cancelled) {
          // Strip the param so a reload or a shared link cannot replay it.
          setCheckout(null);
          const next = new URLSearchParams(searchParams);
          next.delete('checkout');
          setSearchParams(next, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutParam]);

  const handleUpgrade = run(
    async () => {
      const { clientSecret, publishableKey } = await createCheckoutSession(interval);
      setCheckout({ clientSecret, publishableKey });
    },
    {
      offlineMessage: 'Upgrading needs a connection.',
      errorMessage: "Couldn't start checkout. Try again in a moment.",
    },
  );

  const handleManageBilling = run(
    async () => {
      const { url } = await createPortalSession();
      // A NEW TAB, not a navigation. Stripe's Customer Portal is redirect-only (no embedded
      // variant exists), and replacing this document would hand an installed PWA's session to
      // Safari with no reliable way back.
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    {
      offlineMessage: 'Managing your plan needs a connection.',
      errorMessage: "Couldn't open billing management. Try again in a moment.",
    },
  );

  const handleCheckoutFailed = useCallback(() => {
    setCheckout(null);
    showToast("Couldn't load the payment form. Try again in a moment.", { tone: 'error' });
  }, [showToast]);

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      {checkout ? (
        <>
          <div style={sectionLabelStyle}>Payment</div>
          <div style={cardStyle}>
            <EmbeddedCheckout
              clientSecret={checkout.clientSecret}
              publishableKey={checkout.publishableKey}
              onError={handleCheckoutFailed}
            />
          </div>
          <Button variant="ghost" fullWidth onClick={() => setCheckout(null)}>
            Back to plans
          </Button>
        </>
      ) : isPro ? (
        <ProSummary subscription={subscription} pending={pending} onManage={handleManageBilling} />
      ) : (
        <FreeSummary
          interval={interval}
          onIntervalChange={setInterval}
          pending={pending}
          onUpgrade={handleUpgrade}
          onStartFree={() => navigate('/app/log')}
        />
      )}
    </div>
  );
}

function ProSummary({ subscription, pending, onManage }) {
  const cancelling = subscription?.cancelAtPeriodEnd === true;
  const periodEnd = subscription?.currentPeriodEnd;
  const comped = subscription?.comped === true;
  const pastDue = subscription?.status === 'PAST_DUE';

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
        {/* Access continues through Stripe's retry window, so this is a nudge rather than a
            lockout -- see SubscriptionService.isPro for why cutting access mid-dunning is wrong. */}
        {pastDue && (
          <p style={warningLineStyle}>
            We couldn&rsquo;t take your last payment. Update your card to keep Pro.
          </p>
        )}
      </div>

      <div style={sectionLabelStyle}>What Pro includes</div>
      <div style={cardStyle}>
        <BenefitList />
      </div>

      {!comped && (
        <OfflineDisabledWrap message="Managing your plan needs a connection.">
          <Button variant="secondary" fullWidth onClick={onManage} disabled={pending}>
            Manage billing
          </Button>
        </OfflineDisabledWrap>
      )}
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

function FreeSummary({ interval, onIntervalChange, pending, onUpgrade, onStartFree }) {
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
        {/* The one variant="primary" on this screen. The header's own control is a quiet outlined
            badge labelled "Go Pro" precisely so it does not compete with this, and so the two
            never share an accessible name. */}
        <OfflineDisabledWrap message="Upgrading needs a connection.">
          <Button variant="primary" size="lg" fullWidth onClick={onUpgrade} disabled={pending}>
            Upgrade to Pro
          </Button>
        </OfflineDisabledWrap>
        <p style={finePrintStyle}>
          Cancel any time. Your workouts are never deleted — see Terms and Privacy.
        </p>
      </div>

      {/* Equal-weight, not fine print. Someone who arrived from marketing's "Go Pro" was routed
          straight here, and Free is permanent -- deferring costs them nothing. */}
      <Button variant="ghost" fullWidth onClick={onStartFree}>
        Start with Free — decide later
      </Button>
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

const warningLineStyle = {
  color: 'var(--color-warning-text)',
  background: 'var(--color-warning-bg)',
  border: '1px solid var(--color-warning-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-3)',
  margin: 'var(--space-3) 0 0 0',
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

const finePrintStyle = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  margin: 'var(--space-3) 0 0 0',
  textAlign: 'center',
};
