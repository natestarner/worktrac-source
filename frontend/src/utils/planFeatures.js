// The client's copy of the backend's BillingPlan.features() map.
//
// ⚠️ THIS DRIVES CHROME ONLY, exactly like `AccountDto.plan` itself. The server has already
// clamped every read and refused every write before anything here runs; what this buys is a client
// that doesn't offer a control the server would refuse. Never treat it as the authority, and never
// gate anything destructive on it.
//
// It exists because the same question — "does this household's plan include X?" — was being asked
// as a bare `plan !== 'FREE'` at five call sites. That worked with two tiers and stops working the
// moment there are four: each site would have to learn the new tier's name independently, and the
// one that didn't would silently show the wrong thing.

export const PLAN_FEATURES = {
  // Deliberately empty rather than a subset of PLUS: everything Free actually gets is ungated, so
  // none of it is a feature in this map's sense. Mirrors BillingPlan.FREE.features().
  FREE: [],
  PLUS: ['FULL_HISTORY', 'DATA_IMPORT', 'MEMBER_LOGINS'],
  // Everything Plus has, plus what makes Pro a trainer product. A capability lands in this list in
  // the commit that puts a CONTROL behind it -- a feature nothing checks is a gate nobody can fail,
  // and it would drift from the server's map unnoticed.
  //
  // PRIVATE_MEMBERS arrived with the member-visibility toggle in AppSettingsTab. MANAGER_ROLE is
  // still absent on purpose: the server grants it, but no client control asks about it yet.
  PRO: ['FULL_HISTORY', 'DATA_IMPORT', 'MEMBER_LOGINS', 'PRIVATE_MEMBERS', 'ROSTER'],
};

/**
 * Whether this plan includes the feature.
 *
 * ⚠️ AN UNRECOGNISED PLAN ANSWERS TRUE. It fails OPEN, and that is deliberate rather than lazy:
 *
 *   - The auth snapshot survives across deploys (`resilience.md` axis D), so a browser running
 *     yesterday's bundle will be handed tomorrow's tier name. Failing closed would strip paid
 *     features from a paying household for as long as their tab stayed open.
 *   - The cost of being wrong this way is one doomed round trip that the server refuses with a
 *     message. The cost of being wrong the other way is a paying household told they are on Free.
 *
 * This is the same fail-open posture `useAccountAccess` already documents, named once so a new
 * tier cannot quietly break one call site and not the others.
 */
export function planIncludes(plan, feature) {
  const features = PLAN_FEATURES[plan];
  if (!features) return true;
  return features.includes(feature);
}

/**
 * Whether this plan is one the client recognises.
 *
 * A DIFFERENT question from planIncludes, and the one place the answer is "render nothing" rather
 * than "fail open": `PlanBadge` names the plan on screen, and there is no safe way to name one you
 * do not recognise. Showing "Go Plus" to a household that already pays is the worst outcome
 * available there, so absence wins and it self-corrects on the next `/me`.
 */
export function isKnownPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_FEATURES, plan);
}

/**
 * Whether this plan is paid for. For WORDING and layout, never for a gate — a gate asks
 * planIncludes.
 *
 * ⚠️ NOTE THE TWO ABSENT CASES ARE DIFFERENT HERE, unlike in planIncludes:
 *
 *   - An unrecognised NAME ('PRO' reaching a bundle that predates it) answers true. Every tier
 *     added after FREE is a paid one, so a newer name is a paid plan by construction.
 *   - NO PLAN AT ALL (null/undefined — an auth snapshot written before billing shipped, or one
 *     the query has not answered for yet) answers FALSE. There is no plan to call paid.
 *
 * That second case is load-bearing on the billing screen, which picks between the "you have Plus"
 * summary and the "here is what Plus costs" one. Answering true for a household we know nothing
 * about would show the paid summary to somebody who has never paid — and hide the only control
 * that lets them.
 */
export function isPaidPlan(plan) {
  return plan != null && plan !== 'FREE';
}
