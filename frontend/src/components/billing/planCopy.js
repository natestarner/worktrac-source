// The plan vocabulary, in one place, so the billing screen, the handbook and any future upgrade
// prompt cannot drift apart about what Pro actually buys. Same "one derivation, several consumers"
// rule the Trends metric copy follows (see .claude/rules/user-facing-help.md).
//
// PRICES ARE A REPRESENTATION AT THE POINT OF SALE. These strings and the marketing page's pricing
// card must agree, and both must agree with the Stripe prices the backend is configured with. If a
// price changes, all three change together -- e2e/marketing-tests/landing.spec.ts pins the
// marketing half.
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

// What Pro buys. Export is deliberately NOT here -- it is free on both plans, and listing it as a
// Pro benefit would be false at the point of sale.
export const PRO_BENEFITS = [
  { id: 'history', label: 'Your whole history: every workout, for as long as you keep it' },
  { id: 'records', label: 'All-time records and trends over any range' },
  { id: 'import', label: 'Import past workouts from a spreadsheet or another app' },
];
