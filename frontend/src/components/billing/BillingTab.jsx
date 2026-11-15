import { useCallback, useEffect, useRef, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { listLogins } from '../../api/logins';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  prepareStorePurchase,
  reconcileCheckout,
  releaseStorePurchase,
} from '../../api/billing';
import { queryKeys } from '../../api/queryKeys';
import { refreshHistoryForEveryone } from '../../lib/queryClient';
import { formatDate } from '../../utils/datetime';
import Button from '../shared/Button';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import HuddleMark from '../shared/HuddleMark';
import LegalLinks from '../shared/LegalLinks';
import PlanChooser from './PlanChooser';
import EmbeddedCheckout from './EmbeddedCheckout';
import PlusCelebration from './PlusCelebration';
import { PLUS_BENEFITS, PRO_ADDITIONS, PRO_BANDS, planCopy } from './planCopy';
import { accountVocab } from '../../utils/accountVocab';
import { isPaidPlan, planIncludes } from '../../utils/planFeatures';
import BackLink from '../shared/BackLink';
import { useGoBack } from '../../hooks/useGoBack';
import { useBillingChannel } from '../../hooks/useBillingChannel';
import {
  billingSourceName,
  manageSubscriptions,
  openExternal,
  purchase,
  requestRefund,
  restore,
  storeBillingSource,
  storeSource,
} from '../../lib/native';
import { syncAndFinish } from '../../lib/storeSync';
import { findStoreProduct, useStoreCatalog } from '../../hooks/useStoreCatalog';

// The household's plan, and where an upgrade happens.
//
// Reads the plan from TWO places on purpose, and they answer different questions:
//   - `account.plan` (AuthContext, carried in the auth snapshot) is the DERIVED entitlement. It is
//     available on a cold offline boot with no network, so this screen always knows whether the
//     household is Plus.
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
  const goBack = useGoBack();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState('YEAR');
  // Smallest band pre-selected. A trainer arriving here has one or two clients far more often than
  // forty, and pre-selecting a bigger band would quote them a price they did not ask for.
  const [proBand, setProBand] = useState(PRO_BANDS[0].id);
  const [checkout, setCheckout] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  // ⚠️ The tier the RECONCILE reported, not the one in the auth snapshot. The snapshot is refreshed
  // a line later, but it is not the authority on what was just bought: when the webhook rather than
  // the reconcile applies the purchase, /me can still answer FREE here, and a celebration is about
  // the payment that just happened rather than about the account's current steady state.
  const [celebratedPlan, setCelebratedPlan] = useState(null);

  // `online` is deliberately not destructured: OfflineDisabledWrap reads useOnlineStatus
  // itself, and a second copy of that answer here is the kind of duplicate the
  // mechanism table exists to prevent.
  const { pending, run } = useGatedMutation();
  // 'embedded' on the web (everything below is exactly as before), 'store' in an app with a store
  // (In-App Purchase, priced and sold by the store), 'none' in an app without one (the plan, with no
  // price, purchase or portal). lib/native/billingChannel.js has the rules.
  const channel = useBillingChannel();
  // The store's products and its own price strings. Until they load -- and if they never do -- the
  // store channel offers nothing to buy: it fails closed, like 'none'.
  const catalogQuery = useStoreCatalog(channel === 'store');
  const catalog = catalogQuery.data;
  const storeCanSell = channel === 'store' && Boolean(findStoreProduct(catalog, { plan: 'PLUS', interval: 'YEAR' }));

  const { isOwner } = useAccountAccess();

  // Who would lose their sign-in if this household went back to Free -- the numbers behind the
  // notice above "Manage billing". `enabled` is filled in below, once isPlus is known.
  const loginsQuery = useQuery({
    queryKey: queryKeys.accountLogins(),
    queryFn: listLogins,
    // Owner-only, and only while Plus. /api/account/logins requires MANAGE_LOGINS, so asking as a
    // member is a guaranteed 403; and a household that is not Plus has no working member logins to
    // warn about. Not offering a request the app knows will be refused is the same rule as not
    // offering a control that can only fail.
    enabled: isOwner && planIncludes(account?.plan, 'MEMBER_LOGINS'),
    staleTime: 60_000,
  });

  // ACTIVE only. An outstanding invitation has nobody signing in yet, so it has nothing to pause;
  // and isSelf excludes the owner's own login, which a downgrade never touches.
  const pausableLogins = (loginsQuery.data || []).filter(
    (row) => row.status === 'ACTIVE' && !row.isSelf,
  );


  // NOTE: leaving this screen is NOT what releases the deferral -- AppShell does that, keyed on the
  // route. An unmount cleanup here was the obvious implementation and it is wrong: StrictMode
  // double-invokes effects (mount -> cleanup -> mount), so the cleanup fired immediately while the
  // billing screen was still on screen, and the welcome modal appeared over it. Unit tests missed
  // it because RTL does not wrap in StrictMode; the e2e caught it as an "intercepts pointer
  // events" failure, which is this codebase's usual signature for an unexpected overlay.
  //
  // What DOES belong here is the release after a successful payment (below) -- specifically once
  // PlusCelebration is dismissed, not the instant the reconcile resolves. The tour comes after the
  // money decision AND after the celebration of it; releasing any earlier would let the welcome
  // modal stack a second overlay on top of a celebration nobody asked to see behind it yet.
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
  const isPlus = isPaidPlan(plan) || isPaidPlan(subscription?.plan);

  // Stripe returns the browser to /app/billing?checkout=cs_... The backend reads that session
  // directly and applies it, so the upgrade is visible immediately rather than waiting on a
  // webhook -- which is what avoids the classic "I paid and I'm still on Free" ticket.
  //
  // Deliberately NO cancellation-flag cleanup here, even though that is the reflexive pattern for
  // an async effect. StrictMode double-invokes this effect (mount -> cleanup -> mount), and a real
  // network round trip always takes longer than that synchronous cycle -- so a `cancelled` flag
  // set by the first invocation's cleanup is ALWAYS true by the time its own reconcileCheckout()
  // resolves, discarding refreshPeople/invalidateQueries/setShowCelebration on every single run in
  // local dev, silently. Measured directly: the reconcile call still lands and gets applied
  // server-side (confirmed against the real billing_events audit trail -- CHECKOUT_RECONCILED
  // recorded, status=ACTIVE), so the payment was never at risk; only this effect's own follow-up
  // was. `reconciledRef` already fully owns "should this dispatch a NEW reconcile call" -- once
  // set, the second StrictMode invocation's guard correctly no-ops, so there is nothing left for a
  // second guard to protect against.
  //
  // Regression coverage is in e2e (billing.spec.ts), not here: measured directly that jsdom/RTL
  // does not reproduce React's real double-invoke timing for this effect regardless of how the
  // mock's promise is scheduled (checked with a real setTimeout-deferred mock, wrapped in
  // <StrictMode> explicitly -- only one invocation ever fired). A unit test asserting this would
  // pass on both the buggy and fixed code, which is worse than no test at all.
  const checkoutParam = searchParams.get('checkout');
  const reconciledRef = useRef(null);
  // Whether Billing is still on screen when the reconcile settles. Only the URL strip below asks it:
  // setSearchParams navigates relative to THIS route, so run after the person has left (the reconcile
  // goes out to Stripe, which takes long enough to tap away), it pulled them back to Billing from
  // wherever they had gone -- seen in the App Store app's checkout-return flow on lower. Set again on
  // every mount, so StrictMode's mount/cleanup/mount leaves it true; it is NOT a cleanup "cancelled"
  // flag on the success path, which the comment above explains is wrong here.
  const onScreenRef = useRef(false);
  useEffect(() => {
    onScreenRef.current = true;
    return () => {
      onScreenRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!checkoutParam || reconciledRef.current === checkoutParam) return;
    reconciledRef.current = checkoutParam;

    (async () => {
      try {
        const reconciled = await reconcileCheckout(checkoutParam);
        // /me is what carries the derived plan into the auth snapshot, so the header badge and
        // every other consumer update from the same source rather than a second copy of the truth.
        await refreshPeople();
        queryClient.invalidateQueries({ queryKey: queryKeys.subscription() });
        // The plan decides the Free window, and the window clamps every person's History -- so an
        // upgrade has older workouts to show everyone, now, not at the next background refresh.
        refreshHistoryForEveryone(queryClient);
        queryClient.invalidateQueries({ queryKey: queryKeys.historyWindowForEveryone() });
        setCelebratedPlan(reconciled?.plan ?? null);
        setShowCelebration(true);
      } catch {
        // The webhook is the backstop, so a failed reconcile is a delay rather than a lost payment.
        // Saying so beats a spinner that resolves into nothing.
        showToast('Payment received. Your plan will update shortly.', { tone: 'info' });
      } finally {
        // Strip the param so a reload or a shared link cannot replay it -- but only while Billing is
        // still the screen. Once they have left, the param left with them; stripping it would navigate.
        setCheckout(null);
        if (onScreenRef.current) {
          const next = new URLSearchParams(searchParams);
          next.delete('checkout');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutParam]);

  // "Subscribe" tapped on the App Store page arrives as /app/billing?buy=<productId>
  // (useStoreTransactions, from Apple's PurchaseIntent). Apple: the purchase is completed in the app,
  // so once the store's catalog says which plan that product is, this runs the ordinary purchase --
  // prepare, the store's sheet, sync, finish -- and the purchase carries the household token. The
  // person already chose it on the App Store, so it starts by itself; every refusal (already billed,
  // another device mid-purchase, a member's login) is the server's own message, as for a tap here.
  const buyParam = searchParams.get('buy');
  const boughtRef = useRef(null);
  useEffect(() => {
    if (!buyParam || channel !== 'store' || boughtRef.current === buyParam) return;
    if (catalogQuery.isPending) return;
    boughtRef.current = buyParam;
    const next = new URLSearchParams(searchParams);
    next.delete('buy');
    setSearchParams(next, { replace: true });
    const product = (catalog ?? []).find((p) => p.productId === buyParam);
    if (!product) {
      showToast("That plan isn't available here right now.", { tone: 'info' });
      return;
    }
    setInterval(product.interval);
    if (product.band) setProBand(product.band);
    handleUpgrade({ plan: product.plan, band: product.band ?? null, interval: product.interval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyParam, channel, catalogQuery.isPending]);

  // Someone who arrived from marketing's ?plan=pro CTAs (RegisterPage -> ConfirmEmailPage) lands
  // here with ?intent=pro. This screen leads with Plus and keeps the Pro card deliberately quieter
  // and below it -- right for the families who are most of this screen's readers, wrong for a
  // trainer who just told us twice which plan they wanted and would otherwise arrive looking at
  // somebody else's offer. Nothing about the screen's ordering or emphasis changes; it just starts
  // scrolled to the card they came for.
  //
  // Latched into state on the first render because the param is stripped immediately below: the
  // value has to outlive the URL it came from.
  const [wantedProOnArrival] = useState(() => searchParams.get('intent') === 'pro');
  const scrolledToProRef = useRef(false);

  // A callback ref rather than an effect, because the node is what we are waiting for: the Pro
  // card only exists while the account is on Free, so on any other account this never fires and
  // the arrival is simply an ordinary one. Guarded with scrollIntoView's own presence for jsdom,
  // matching HistoryTab and ExercisePicker -- there is no shared scroll helper to reuse.
  const proCardRef = useCallback(
    (node) => {
      if (!node || !wantedProOnArrival || scrolledToProRef.current) return;
      scrolledToProRef.current = true;
      if (node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [wantedProOnArrival],
  );

  // Strip it for the same reason the checkout param is stripped: a reload or a shared link must
  // not replay the jump. Every recognised or unrecognised value goes, not just 'pro', so nothing
  // is left sitting in the URL.
  const intentParam = searchParams.get('intent');
  useEffect(() => {
    if (!intentParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('intent');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentParam]);

  // ⚠️ Takes the tier explicitly rather than reading component state, and the default is PLUS.
  // It was `createCheckoutSession(interval)` with no plan at all, which the server reads as Plus --
  // so while Pro was fully buyable over the API, every button on this screen sold Plus. A caller
  // that forgets the argument still gets the old, correct behaviour rather than a 400.
  const handleUpgrade = run(
    async ({ plan = 'PLUS', band = null, interval: chosen = interval } = {}) => {
      if (channel === 'store') {
        await buyInStore({ plan, band, interval: chosen });
        return;
      }
      const { clientSecret, publishableKey } = await createCheckoutSession(chosen, { plan, band });
      setCheckout({ clientSecret, publishableKey });
    },
    {
      offlineMessage: 'Upgrading needs a connection.',
      errorMessage: "Couldn't start checkout. Try again in a moment.",
      // The store path's refusals are written for people: "billed on huddle.fitness", "a purchase is
      // already in progress on another device", or the store's own reason. Off on the web, as before.
      showServerMessage: channel === 'store',
    },
  );

  // In-App Purchase (docs/in-app-purchase-plan.md). The backend says whether this household may buy
  // and hands over its token; the store takes the payment; the backend verifies the store's proof and
  // writes the plan; only then is the transaction finished (lib/storeSync).
  async function buyInStore({ plan, band, interval: chosen }) {
    const store = storeSource();
    const { productId, accountToken } = await prepareStorePurchase(store, { plan, band, interval: chosen });
    let outcome;
    try {
      outcome = await purchase({ productId, accountToken });
    } catch (error) {
      releaseStorePurchase(store).catch(() => {});
      throw error;
    }
    if (outcome?.result === 'cancelled') {
      // Let another device start one now rather than in ten minutes.
      releaseStorePurchase(store).catch(() => {});
      return;
    }
    if (outcome?.result === 'pending') {
      // Ask to Buy, or the bank's approval. It arrives later through useStoreTransactions.
      showToast("Waiting for approval. Your plan will update once it's approved.", { tone: 'info' });
      return;
    }
    let confirmed = null;
    try {
      confirmed = await syncAndFinish([outcome]);
    } catch {
      // Paid, but not confirmed with us yet. The transaction stays unfinished, so the store hands it
      // back and useStoreTransactions sends it again: a delay, never a lost payment.
      showToast('Purchase received. Your plan will update shortly.', { tone: 'info' });
      return;
    }
    refreshAfterPlanChange();
    if (isPaidPlan(confirmed?.plan)) {
      setCelebratedPlan(confirmed.plan);
      setShowCelebration(true);
    } else {
      showToast('Purchase received. Your plan will update shortly.', { tone: 'info' });
    }
  }

  // Restore Purchases, which Apple requires wherever subscriptions are sold. Re-sends every current
  // subscription on this store account; each is applied to the household it was bought for, which
  // may not be this one.
  const handleRestore = run(
    async () => {
      const proofs = await restore();
      const restored = proofs.length ? await syncAndFinish(proofs) : null;
      refreshAfterPlanChange();
      if (!isPaidPlan(restored?.plan)) {
        showToast(`No subscription to restore for this ${storeAccountName()} and household.`, { tone: 'info' });
      }
    },
    {
      offlineMessage: 'Restoring purchases needs a connection.',
      errorMessage: "Couldn't restore purchases. Try again in a moment.",
      showServerMessage: true,
    },
  );

  // The store's own manage screen: change plan, switch monthly/yearly, cancel. It is a sheet over the
  // app, so its closing is the moment to re-read what it may have changed.
  // The store's own refund-request sheet. Only Apple offers one in the app; it decides, and emails
  // the person. A granted refund ends the plan through the store's notification, so nothing here
  // changes the plan.
  const handleRequestRefund = run(
    async () => {
      const { result } = await requestRefund();
      if (result === 'requested') {
        // Only Apple offers this sheet (paidControls), so it is Apple that answers.
        showToast('Request sent. Apple will email you its decision.', { tone: 'info' });
      } else if (result === 'none') {
        showToast(`This ${storeAccountName()} has no Huddle subscription to refund. Try the device that bought it.`, { tone: 'info' });
      }
    },
    {
      offlineMessage: 'Requesting a refund needs a connection.',
      errorMessage: "Couldn't open the refund request. Try again in a moment.",
    },
  );

  const handleManageInStore = run(
    async () => {
      const { result } = await manageSubscriptions();
      if (result === 'unavailable') {
        // The iPad app on a Mac: Apple's sheet isn't available there.
        showToast('Manage it in the App Store app: your account, then Subscriptions.', { tone: 'info' });
        return;
      }
      refreshAfterPlanChange();
    },
    {
      offlineMessage: 'Managing your plan needs a connection.',
      errorMessage: "Couldn't open subscription management. Try again in a moment.",
    },
  );

  // Whatever the portal could have changed: the plan (/me), the subscription's wording (renews vs
  // ends), who would lose a login, and -- if the plan itself moved -- every person's History window.
  // The portal changes Stripe at once, but our copy updates when its webhook lands, so this can
  // still read the old state for a second or two; any later visit to this screen refetches.
  function refreshAfterPlanChange() {
    refreshPeople().catch(() => {});
    queryClient.invalidateQueries({ queryKey: queryKeys.subscription() });
    queryClient.invalidateQueries({ queryKey: queryKeys.accountLogins() });
    refreshHistoryForEveryone(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.historyWindowForEveryone() });
  }

  const handleManageBilling = run(
    async () => {
      // Only ever the web now: in the app, a Stripe-billed household is told where its plan lives
      // and offered no portal (docs/in-app-purchase-plan.md, rule 1).
      const { url } = await createPortalSession();
      // A NEW TAB, not a navigation. Stripe's Customer Portal is redirect-only (no embedded
      // variant exists), and replacing this document would hand an installed PWA's session to
      // Safari with no reliable way back. openExternal's web branch is exactly that new tab; in
      // the App Store app it is the in-app browser sheet, and closing that sheet is the only sign
      // the person is back (it never backgrounds the app, so refetch-on-focus never fires).
      // Not awaited past opening: the gated button's spinner is for opening the portal, not for
      // the whole visit.
      await openExternal(url, { onClose: refreshAfterPlanChange });
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

  function handleDismissCelebration() {
    setShowCelebration(false);
    releaseRef.current();
  }

  return (
    <div>
      <BackLink onClick={goBack}>&larr; Back</BackLink>

      {checkout ? (
        <>
          <SectionLabel>Payment</SectionLabel>
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
      ) : isPlus ? (
        <PaidSummary
          plan={isPaidPlan(plan) ? plan : subscription?.plan}
          vocab={accountVocab(account?.vocab)}
          subscription={subscription}
          pending={pending}
          pausableLogins={pausableLogins}
          interval={interval}
          proBand={proBand}
          onProBandChange={setProBand}
          {...paidControls(channel, subscription?.billingSource, {
            handleManageBilling,
            handleManageInStore,
            handleRequestRefund,
            handleUpgrade,
          })}
        />
      ) : (
        <FreeSummary
          canBuy={channel === 'embedded' || storeCanSell}
          unavailableLine={channel === 'store' && !storeCanSell ? catalogUnavailableLine(catalogQuery) : null}
          prices={channel === 'store' ? storePrices(catalog) : null}
          storeFinePrint={channel === 'store' ? storeFinePrint() : null}
          onRestore={channel === 'store' ? handleRestore : null}
          interval={interval}
          proBand={proBand}
          onProBandChange={setProBand}
          onIntervalChange={setInterval}
          pending={pending}
          onUpgrade={handleUpgrade}
          onStartFree={() => navigate('/app/log')}
          proCardRef={proCardRef}
        />
      )}

      {showCelebration && <PlusCelebration plan={celebratedPlan ?? plan} onDismiss={handleDismissCelebration} />}
    </div>
  );
}

// ⚠️ THIS SCREEN NAMES THE TIER FROM planCopy, and it did not always. It was `PlusSummary`, and
// every string in it -- the heading, the benefit list, the comped line, the past-due nudge -- said
// "Plus" as a literal while the branch that chooses it asks isPaidPlan, which is true for Pro. So a
// trainer who had just paid $79 for Pro opened Plan & billing and was told they were on Huddle
// Plus, under a list of Plus's four benefits with none of the four they had actually bought.
//
// The tier is asked for ONCE, at the top, and everything below reads that answer. Adding a second
// `plan === 'PRO'` branch further down is the bug this shape exists to prevent -- see billing.md.
/**
 * Which controls a PAYING household gets, from two facts: how this copy of Huddle sells
 * (`channel`), and who is billing the household (`billingSource`, from SubscriptionDto). One
 * household, one billing source (docs/in-app-purchase-plan.md), so a plan is only ever changed
 * where it is billed:
 *
 *   billed by...          on the web                       in the app (store channel)
 *   Stripe (or unknown)   Manage billing (Customer Portal)  "billed on huddle.fitness", no link
 *   this app's store      "billed through the App Store"   Manage subscription (the store's sheet)
 *   another store         "billed through Google Play"     the same sentence
 *
 * `billedElsewhere` is the sentence for the cases with no control. An unknown billingSource (a
 * server that predates the field, resilience.md axis D) is treated as Stripe -- what every paying
 * household was before stores existed.
 */
function paidControls(channel, billingSource, { handleManageBilling, handleManageInStore, handleRequestRefund, handleUpgrade }) {
  const source = billingSource ?? 'STRIPE';
  if (channel === 'none') return { onManage: null, onUpgrade: null, billedElsewhere: null };
  if (channel === 'store') {
    if (source === storeBillingSource()) {
      return {
        onManage: handleManageInStore,
        manageLabel: 'Manage subscription',
        // Apple's in-app refund sheet. Google Play has none (refunds are requested on its site).
        onRequestRefund: source === 'APP_STORE' ? handleRequestRefund : null,
        onUpgrade: null,
        billedElsewhere: null,
        billedInStore: billingSourceName(source),
      };
    }
    return {
      onManage: null,
      onUpgrade: null,
      billedElsewhere:
        source === 'STRIPE'
          ? 'Your plan is billed on huddle.fitness. Sign in there to change it.'
          : `Your plan is billed through ${billingSourceName(source)}. Change it on a device that uses ${billingSourceName(source)}.`,
    };
  }
  if (source !== 'STRIPE') {
    return {
      onManage: null,
      onUpgrade: null,
      billedElsewhere: `Your plan is billed through ${billingSourceName(source)}. Change or cancel it in the subscription settings of the phone or tablet you bought it on.`,
    };
  }
  return { onManage: handleManageBilling, onUpgrade: handleUpgrade, billedElsewhere: null };
}

// What the Free screen says when the store channel has nothing to sell yet. Keyed on the catalog
// QUERY's state, never on connectivity: a paused fetch (offline, nothing cached) and a failed one
// both present as "no data", and a spinner over either would never resolve.
function catalogUnavailableLine(catalogQuery) {
  if (catalogQuery.isPending && catalogQuery.fetchStatus === 'fetching') return 'Loading plans\u2026';
  if (catalogQuery.fetchStatus === 'paused') return 'Plans need a connection to load.';
  return "Plans couldn't be loaded from the store right now. Try again later.";
}

// The store's own price strings, by plan/band/interval, for the price lines on the Free screen.
function storePrices(catalog) {
  return ({ plan, band = null, interval }) => findStoreProduct(catalog, { plan, band, interval })?.displayPrice ?? null;
}

const STORE_ACCOUNT = { APP_STORE: 'Apple ID', GOOGLE_PLAY: 'Google account' };

function storeAccountName() {
  return STORE_ACCOUNT[storeBillingSource()] ?? 'store account';
}

// The auto-renewal disclosure the stores require beside a subscription's price.
function storeFinePrint() {
  return `Payment is charged to your ${storeAccountName()}. Your subscription renews automatically unless you cancel it at least 24 hours before the end of the period; manage or cancel it in your ${storeAccountName()}'s subscription settings.`;
}

function PaidSummary({
  plan,
  vocab,
  subscription,
  pending,
  onManage,
  manageLabel = 'Manage billing',
  billedElsewhere = null,
  billedInStore = null,
  onRequestRefund = null,
  pausableLogins = [],
  interval,
  proBand,
  onProBandChange,
  onUpgrade,
}) {
  const cancelling = subscription?.cancelAtPeriodEnd === true;
  const periodEnd = subscription?.currentPeriodEnd;
  const comped = subscription?.comped === true;
  const pastDue = subscription?.status === 'PAST_DUE';
  // Null for a tier this bundle predates (resilience.md axis D). Falling back to Plus's copy would
  // describe a paid household with the wrong tier's benefits, which is the failure above; falling
  // back to the plan KEY ("PRO") is merely ugly, and only for a build that is already behind.
  const copy = planCopy(plan);
  const name = copy?.name ?? plan;
  // Everything Plus includes, plus what this tier adds over it -- `benefits` is deliberately only
  // the increment (see planCopy), and a Pro household has all of both.
  const benefits = plan === 'PLUS' ? PLUS_BENEFITS : [...PLUS_BENEFITS, ...(copy?.benefits ?? [])];

  return (
    <>
      <SectionLabel>Your plan</SectionLabel>
      <div style={cardStyle}>
        {/* The mark, not the wordmark: "Huddle Plus" is already spelled out beside it, and the
            horizontal lockup would repeat the word. aria-hidden inside HuddleMark, so a screen
            reader hears the heading once rather than twice. */}
        <div style={planTitleRowStyle}>
          <HuddleMark size={40} />
          <div style={planHeadingStyle}>Huddle {name}</div>
        </div>
        <p style={mutedLineStyle}>
          {comped
            ? `Your ${vocab.account} has ${name} on the house, with our thanks for being here early.`
            : renewalLine(cancelling, periodEnd, name, plan)}
        </p>
        {/* What the band actually bought AND how much of it is used, "12 of 15" -- both halves come
            from the server (SubscriptionDto.clientSeats / .clientCount), never recomputed here from
            the people list, which would be a second derivation free to disagree with the one that
            actually refuses an invite. Absent on a household tier, which has no seats at all. */}
        {seatLine(subscription, plan, vocab) && (
          <p style={mutedLineStyle}>{seatLine(subscription, plan, vocab)}</p>
        )}
        {/* Access continues through Stripe's retry window, so this is a nudge rather than a
            lockout -- see SubscriptionService.isPlus for why cutting access mid-dunning is wrong. */}
        {pastDue && (
          <p style={warningLineStyle}>
            {billedInStore
              ? `${billedInStore[0].toUpperCase()}${billedInStore.slice(1)} couldn\u2019t take your last payment. Update your payment method in Settings to keep ${name}.`
              : <>We couldn&rsquo;t take your last payment. Update your card to keep {name}.</>}
          </p>
        )}
        {!comped && billedInStore && <p style={mutedLineStyle}>Billed through {billedInStore}.</p>}
        {!comped && billedElsewhere && <p style={mutedLineStyle}>{billedElsewhere}</p>}
      </div>

      <SectionLabel>What {name} includes</SectionLabel>
      <div style={cardStyle}>
        <BenefitList benefits={benefits} />
      </div>

      {/* ⚠️ Said HERE, and here is the only place it can be said.
          Cancelling happens in Stripe's hosted portal, which we do not control and cannot add a
          confirmation step to -- so "Manage billing" is the last screen of ours an owner sees
          before they can downgrade. An owner who does not know that other people's logins stop
          working will find out from those people.

          Counted, not generic: "2 logins" is actionable where "any member logins" is not, and the
          two names make it concrete. Rendered only when there is somebody to affect, so a
          single-login household never sees a warning about a thing it does not use. */}
      {pausableLogins.length > 0 && (
        <div style={pauseNoticeStyle}>
          <strong>
            {pausableLogins.length === 1
              ? '1 personal login will stop working'
              : `${pausableLogins.length} personal logins will stop working`}
          </strong>{' '}
          if this {vocab.account} goes back to Free &mdash; {formatNames(pausableLogins)} would no
          longer be able to sign in on their own device. Nothing is deleted: their workouts stay,
          you keep seeing everything, and their logins start working again the moment you return to{' '}
          {name}.
        </div>
      )}

      {!comped && onManage && (
        <OfflineDisabledWrap message="Managing your plan needs a connection.">
          {/* marginBottom, not the ProUpgradeCard SectionLabel below getting a matching marginTop:
              FreeSummary's copy of that same label already sits under a cardStyle div (its own
              24px marginBottom), so a margin on the label would double up there. This button is
              the one place nothing already supplies that gap -- on a narrow phone "Training
              clients?" landed close enough under it to read as part of the same control. */}
          <Button variant="secondary" fullWidth onClick={onManage} disabled={pending} style={{ marginBottom: 'var(--space-6)' }}>
            {manageLabel}
          </Button>
        </OfflineDisabledWrap>
      )}

      {!comped && onRequestRefund && (
        <OfflineDisabledWrap message="Requesting a refund needs a connection.">
          <Button variant="ghost" fullWidth onClick={onRequestRefund} disabled={pending} style={{ marginBottom: 'var(--space-6)' }}>
            Request a refund
          </Button>
        </OfflineDisabledWrap>
      )}

      {/* Plus -> Pro, the one upgrade path this screen offers a PAYING household. Reuses
          ProUpgradeCard verbatim rather than a second card -- it is already checked against every
          other label for the substring rule (billing.md), and the two never share a screen: this
          renders only for PLUS, ProUpgradeCard's other call site only for FREE. No `cardRef` here --
          the ?intent=pro scroll-into-view only ever arrives at the FREE screen.

          ctaVariant="primary" here, unlike the FREE call below: this screen's only other button is
          "Manage billing" (secondary), so nothing competes for the one variant="primary" a screen
          may carry (frontend-core.md), and a household already paying for Plus is exactly who
          should see this upsell in the same brand-accent fill as every other primary action rather
          than blending into the surface behind it. */}
      {plan === 'PLUS' && onUpgrade && (
        <ProUpgradeCard
          interval={interval}
          band={proBand}
          onBandChange={onProBandChange}
          pending={pending}
          onUpgrade={onUpgrade}
          ctaVariant="primary"
        />
      )}
    </>
  );
}

/**
 * What this subscription's band covers, or null when the tier is not licensed by clients at all.
 *
 * ⚠️ Null and "unlimited" are DIFFERENT absences, which is why SubscriptionDto.clientSeats is null
 * rather than a large sentinel: a household tier has no seats to describe, while an Unlimited Pro
 * band has no ceiling to name. A sentinel would render one of them as the other.
 *
 * Leads with the BAND NAME ("Starter", "Practice", ...) so a trainer can tell which one they are
 * actually on without opening the Customer Portal -- looked up by matching `clientSeats` back
 * against PRO_BANDS rather than carried on the DTO, since the band's client count already is that
 * lookup key and a second field would just be a second way to disagree with it.
 *
 * `clientCount` is USAGE, not the allowance -- deliberately a second field from `clientSeats`
 * rather than derived from the people list here, for the same reason the server computes it: this
 * screen has no roster read of its own, and a household on Free never even has `clientCount`
 * (billing.md's "ask for a feature" -- Pro-only, so SubscriptionDto clamps it there). Its absence
 * (an older server build predating this field, resilience.md axis D) degrades to the allowance-only
 * line rather than to nothing.
 */
function seatLine(subscription, plan, vocab) {
  if (plan !== 'PRO') return null;
  const seats = subscription?.clientSeats;
  const count = subscription?.clientCount;
  const band = PRO_BANDS.find((b) => b.clients === seats);
  const prefix = band ? `${band.name}: ` : '';
  if (seats == null) {
    return count == null
      ? `${prefix}No limit on how many ${vocab.member}s you take on.`
      : `${prefix}${count} ${vocab.member}${count === 1 ? '' : 's'}, no limit.`;
  }
  return count == null
    ? `${prefix}Covers up to ${seats} ${vocab.member}${seats === 1 ? '' : 's'}.`
    : `${prefix}${count} of ${seats} ${vocab.member}s.`;
}

// "ends" vs "renews" is the whole reassurance: someone who has cancelled needs to see that they
// keep everything until the period they paid for actually runs out.
//
// ⚠️ "Everything in Huddle, with no limits" is only TRUE of Plus. It used to be the fallback for
// every paid tier whenever `periodEnd` hadn't loaded yet (subscriptionQuery still in flight, or
// offline with only the auth snapshot's bare plan name to go on) -- so a Pro Starter household,
// which has a very real 5-client ceiling, was told in the same breath it had none. Gated on the
// plan explicitly (`=== 'PLUS'`) rather than on `!== 'PRO'`, so a tier this bundle predates
// (resilience.md axis D) falls to the honest generic line rather than inheriting an unlimited claim
// nobody checked.
function renewalLine(cancelling, periodEnd, name, plan) {
  if (!periodEnd) {
    return plan === 'PLUS' ? 'Everything in Huddle, with no limits.' : `You're set up with Huddle ${name}.`;
  }
  return cancelling
    ? `${name} until ${formatDate(periodEnd)}: you keep everything until then.`
    : `Renews ${formatDate(periodEnd)}.`;
}

function FreeSummary({
  interval,
  onIntervalChange,
  proBand,
  onProBandChange,
  pending,
  onUpgrade,
  onStartFree,
  proCardRef,
  canBuy = true,
  unavailableLine = null,
  prices = null,
  storeFinePrint = null,
  onRestore = null,
}) {
  const planCard = (
    <div style={cardStyle}>
      <div style={planHeadingStyle}>Free</div>
      <p style={mutedLineStyle}>
        Everyone in your household, unlimited workouts, and your full data export. Always.
      </p>
    </div>
  );

  // The App Store app outside the US storefront (billing channel 'none'): the plan and what it
  // includes, and nothing that prices, sells or points toward buying another.
  if (!canBuy) {
    return (
      <>
        <SectionLabel>Your plan</SectionLabel>
        {planCard}
        {unavailableLine && <p style={mutedLineStyle}>{unavailableLine}</p>}
        <Button variant="ghost" fullWidth onClick={onStartFree}>
          Back to logging
        </Button>
      </>
    );
  }

  return (
    <>
      <SectionLabel>Your plan</SectionLabel>
      {planCard}

      <SectionLabel>Upgrade to Plus</SectionLabel>
      <div style={cardStyle}>
        <PlanChooser value={interval} onChange={onIntervalChange} prices={prices} />
        <BenefitList />
        {/* The one variant="primary" on this screen. The header's own control is a quiet outlined
            badge labelled "Go Plus" precisely so it does not compete with this, and so the two
            never share an accessible name. */}
        <OfflineDisabledWrap message="Upgrading needs a connection.">
          <Button variant="primary" size="lg" fullWidth onClick={() => onUpgrade({ plan: 'PLUS' })} disabled={pending}>
            Upgrade to Plus
          </Button>
        </OfflineDisabledWrap>
        <p style={finePrintStyle}>
          Cancel any time. Your workouts are never deleted. See <LegalLinks />.
        </p>
        {storeFinePrint && <p style={finePrintStyle}>{storeFinePrint}</p>}
      </div>

      <ProUpgradeCard
        interval={interval}
        band={proBand}
        onBandChange={onProBandChange}
        pending={pending}
        onUpgrade={onUpgrade}
        cardRef={proCardRef}
        prices={prices}
      />

      {onRestore && (
        <OfflineDisabledWrap message="Restoring purchases needs a connection.">
          <Button variant="ghost" fullWidth onClick={onRestore} disabled={pending}>
            Restore purchases
          </Button>
        </OfflineDisabledWrap>
      )}

      {/* Equal-weight, not fine print. Someone who arrived from marketing's "Go Plus" was routed
          straight here, and Free is permanent -- deferring costs them nothing. */}
      <Button variant="ghost" fullWidth onClick={onStartFree}>
        Start with Free, decide later
      </Button>
    </>
  );
}

/**
 * The trainer path off the Free screen.
 *
 * Quieter than the Plus card above it and placed below on purpose: the overwhelming majority of
 * people reading this screen are families, and a Pro card competing for attention would cost more
 * conversions than it wins. A trainer who needs it is looking for it.
 *
 * ⚠️ "Subscribe to Pro" is checked against every other control on this screen for the substring
 * rule -- Upgrade to Plus / Start with Free, decide later / Manage billing / Go Plus. It shares no
 * substring with any of them, and none contains it.
 *
 * `ctaVariant` defaults to 'secondary' for the FREE screen below, which already spends its one
 * variant="primary" on "Upgrade to Plus" sitting above this card -- a second primary button on
 * the same screen is exactly what frontend-core.md's "at most one visible per screen" rule
 * forbids. BillingTab's PLUS call site passes 'primary': there this card is the only upgrade on
 * screen, so it can be the one, and the same neutral outline "Manage billing" uses read as
 * "nothing to look at here" on a card meant to be noticed, where the accent fill every other
 * primary action carries reads as "look here".
 */
function ProUpgradeCard({
  interval,
  band,
  onBandChange,
  pending,
  onUpgrade,
  cardRef,
  ctaVariant = 'secondary',
  prices = null,
}) {
  // In the store channel, only the bands the store actually offers.
  const bands = prices ? PRO_BANDS.filter((b) => prices({ plan: 'PRO', band: b.id, interval })) : PRO_BANDS;
  const selected = bands.find((b) => b.id === band) ?? bands[0];
  if (!selected) return null;
  // The interval chosen above drives this price too, so the two cards can never quote different
  // billing periods on one screen. In the store channel it is the store's own price string.
  const webPrice = interval === 'YEAR' ? selected.year : selected.month;
  const price = prices
    ? `${prices({ plan: 'PRO', band: selected.id, interval })} / ${interval === 'YEAR' ? 'year' : 'month'}`
    : webPrice;

  return (
    <>
      {/* The scroll anchor for a ?intent=pro arrival sits on the LABEL, not on the card below it:
          the label is the top of this block, and scrolling to the card alone would park
          "Training clients?" just above the viewport -- losing the one line that says what the
          card is. SectionLabel spreads ...rest onto its element, and React 19 passes ref as an
          ordinary prop, so this reaches the real DOM node. */}
      <SectionLabel ref={cardRef} className="pro-upgrade-anchor">Training clients?</SectionLabel>
      <div style={cardStyle}>
        <p style={mutedLineStyle}>
          Huddle Pro gives every client their own login, keeps their training private from each
          other, and shows you who has stopped showing up.
        </p>

        <label htmlFor="pro-band" style={{ ...mutedLineStyle, display: 'block', marginBottom: 'var(--space-1)' }}>
          How many clients?
        </label>
        <select
          id="pro-band"
          value={selected.id}
          onChange={(event) => onBandChange(event.target.value)}
          style={bandSelectStyle}
        >
          {bands.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} &mdash; {option.label}
            </option>
          ))}
        </select>

        <p style={{ ...planHeadingStyle, marginTop: 'var(--space-3)' }}>{price}</p>

        <ul style={benefitListStyle}>
          {PRO_ADDITIONS.map((benefit) => (
            <li key={benefit.id} style={benefitItemStyle}>
              <BenefitCheck />
              <span>{benefit.label}</span>
            </li>
          ))}
        </ul>

        {/* See ctaVariant's header comment above: secondary on the FREE screen (which already has
            its one primary above this card), primary on the PLUS screen (which has none). */}
        <OfflineDisabledWrap message="Upgrading needs a connection.">
          <Button variant={ctaVariant} size="lg" fullWidth
                  onClick={() => onUpgrade({ plan: 'PRO', band: selected.id })} disabled={pending}>
            Subscribe to Pro
          </Button>
        </OfflineDisabledWrap>
        <p style={finePrintStyle}>
          Your own training is free &mdash; everyone else on the account takes a client place,
          assistants included. Change bands whenever your roster does.
        </p>
      </div>
    </>
  );
}

const bandSelectStyle = {
  width: '100%',
  minHeight: 44,
  padding: '0 var(--space-2)',
  // 16px, or iOS Safari zooms the viewport on focus -- the same rule every input in this app
  // follows (frontend-core.md).
  fontSize: 'var(--text-md)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

// Deliberately the same treatment as the marketing site's pricing card -- an accent tick per
// benefit -- so the page someone read before signing up and the screen they upgrade on feel like
// one product rather than two.
//
// --color-accent is the right token here: it fails AA as small TEXT, but icons, borders and the
// focus ring are exactly what it is for (see .claude/rules/frontend-core.md).
function BenefitCheck() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BenefitList({ benefits = PLUS_BENEFITS }) {
  return (
    <ul style={benefitListStyle}>
      {benefits.map((benefit) => (
        <li key={benefit.id} style={benefitItemStyle}>
          <BenefitCheck />
          <span>{benefit.label}</span>
        </li>
      ))}
    </ul>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '20px',
  marginBottom: 24,
};

const planTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-2)',
};

const planHeadingStyle = {
  fontSize: 'var(--text-xl)',
  fontWeight: 'var(--weight-bold)',
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
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-3)',
  lineHeight: 1.45,
};

const finePrintStyle = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  margin: 'var(--space-3) 0 0 0',
  textAlign: 'center',
};

// "Sam", "Sam and Alex", "Sam, Alex and Robin" -- the shapes a household of 2-5 actually produces.
function formatNames(rows) {
  const names = rows.map((row) => row.personName);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const pauseNoticeStyle = {
  margin: '0 0 var(--space-4)',
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--color-muted)',
};
