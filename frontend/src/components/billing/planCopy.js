// The plan vocabulary, in one place, so the billing screen, the handbook and any future upgrade
// prompt cannot drift apart about what a tier actually buys. Same "one derivation, several
// consumers" rule the Trends metric copy follows (see .claude/rules/user-facing-help.md).
//
// ⚠️ PRICES ARE A REPRESENTATION AT THE POINT OF SALE. These strings, the marketing pages and the
// Stripe prices the backend is configured with must all agree. If a price changes, all three change
// together -- e2e/marketing-tests/landing.spec.ts pins the family half and
// e2e/marketing-tests/for-trainers.spec.ts pins all eight Pro numbers.
//
// ⚠️ THIS FILE DESCRIBES; IT NEVER DECIDES. What a household is ENTITLED to comes from
// BillingPlan.features() on the server and planFeatures.js on the client. A benefit listed here and
// not granted there is a promise at the point of sale that the product does not keep -- which is
// worse than an unadvertised feature, and is exactly why export is absent from every benefit list
// below (it is free on every tier, so selling it would be false).

export const PRICING = {
  YEAR: {
    id: 'YEAR',
    label: 'Yearly',
    price: '$29 / year',
    // The annual plan priced in monthly units, so both options compare on one axis. 29 / 12.
    equivalent: '$2.42 a month',
    savings: 'Save 39%',
  },
  MONTH: {
    id: 'MONTH',
    label: 'Monthly',
    price: '$3.99 / month',
    equivalent: null,
    savings: null,
  },
};

// Yearly first, and pre-selected: the marketing pricing card headlines $29/year with "or $3.99 a
// month" subordinate, and the price must not change shape between the page someone just read and
// the screen they pay on.
export const INTERVAL_ORDER = ['YEAR', 'MONTH'];

// What Plus buys. Export is deliberately NOT here -- it is free on every plan, and listing it as a
// paid benefit would be false at the point of sale.
export const PLUS_BENEFITS = [
  { id: 'history', label: 'Your whole history: every workout, for as long as you keep it' },
  { id: 'records', label: 'All-time records and trends over any range' },
  { id: 'import', label: 'Import past workouts from a spreadsheet or another app' },
  { id: 'logins', label: 'A personal login for anyone in the household who wants one' },
];

// What Pro adds ON TOP of Plus. Written as the difference rather than the whole list, because that
// is the question somebody on this screen is actually asking -- and because restating Plus's four
// lines here is how the two drift.
//
// ⚠️ "Clients can't see each other" is the SOFTENED claim, and the wording is load-bearing. What
// shipped is one account-wide switch defaulting to private, not per-client granularity; "each
// client's data is private" would promise a setting that does not exist. Same sentence as
// for-trainers.html, which has a spec pinning it.
export const PRO_ADDITIONS = [
  { id: 'private', label: "Clients can't see each other, and you can see all of them" },
  { id: 'assistants', label: 'Assistants who can log for every client, but not touch billing' },
  { id: 'programs', label: 'Assign a program, with the weights and reps you want hit' },
  { id: 'roster', label: 'A roster that shows you who has stopped showing up' },
];

// ⚠️ THE BAND IS A CEILING ON ADDING, NEVER A REVOCATION. Going over it refuses the NEXT client;
// everyone already in the account keeps working. The copy must never imply otherwise -- a trainer
// reading "up to 15" as "we will cut you off at 15" is the difference between upgrading and
// churning.
//
// `clients` is the ceiling as a number so a caller can compare it against a real seat count;
// `label` is how it is said. Unlimited carries null, never a large sentinel, for the same reason
// RosterEntryDto.daysSinceLastWorkout does: a sentinel sorts correctly and then renders.
export const PRO_BANDS = [
  { id: 'STARTER', name: 'Starter', clients: 5, label: 'Up to 5 clients', month: '$19 / month', year: '$190 / year' },
  { id: 'STUDIO', name: 'Studio', clients: 15, label: 'Up to 15 clients', month: '$39 / month', year: '$390 / year' },
  { id: 'PRACTICE', name: 'Practice', clients: 40, label: 'Up to 40 clients', month: '$79 / month', year: '$790 / year' },
  { id: 'UNLIMITED', name: 'Unlimited', clients: null, label: 'No client limit', month: '$149 / month', year: '$1,490 / year' },
];

/**
 * Every tier, in the order somebody comparing them reads them.
 *
 * ⚠️ This replaced a lone `PRO_BENEFITS` list that meant PLUS. With two tiers a single list was
 * fine; with four it is how a screen ends up describing the wrong one. Ask this map for a tier's
 * copy rather than reaching for a benefits constant directly.
 *
 * `benefits` is what that tier ADDS over the one before it, which is what the billing screen and
 * the handbook both want. FREE's is empty because everything Free gets is ungated -- the same
 * reason BillingPlan.FREE.features() is empty.
 */
export const PLANS = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Start tracking together',
    blurb: 'Log workouts and add family members on a shared device. View the last 90 days of progress.',
    benefits: [],
    bands: null,
  },
  PLUS: {
    id: 'PLUS',
    name: 'Plus',
    tagline: 'Full history, individual accounts',
    blurb: 'Unlock complete workout history and give every family member their own login.',
    benefits: PLUS_BENEFITS,
    bands: null,
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    tagline: 'Private coaching, full control',
    blurb: "Everything trainers need — individual client logins, with your clients' training kept private from each other.",
    benefits: PRO_ADDITIONS,
    bands: PRO_BANDS,
  },
};

// The order a comparison reads in. TEAM joins this list when it exists; until then, naming it here
// would advertise something nobody can buy.
export const PLAN_ORDER = ['FREE', 'PLUS', 'PRO'];

/**
 * The copy for a tier, or null for one this build has never heard of.
 *
 * ⚠️ Null rather than a fallback to Free. A newer server naming a tier this bundle predates is a
 * real case (`resilience.md` axis D), and describing it with the WRONG tier's benefits is worse
 * than describing it with none -- the caller can render nothing, but it cannot detect a lie.
 */
export function planCopy(plan) {
  return PLANS[plan] ?? null;
}
