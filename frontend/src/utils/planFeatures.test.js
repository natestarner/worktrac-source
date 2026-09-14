import { describe, it, expect } from 'vitest';
import { PLAN_FEATURES, planIncludes, isKnownPlan, isPaidPlan } from './planFeatures';

// The polarity of the absent/unknown cases is the entire reason this module exists, so it is what
// these tests are mostly about. Getting one of them backwards does not throw and does not fail any
// screen's own test -- it quietly tells a paying household they are on Free, or the reverse.

describe('planIncludes', () => {
  it('answers from the map for a plan it knows', () => {
    expect(planIncludes('PLUS', 'FULL_HISTORY')).toBe(true);
    expect(planIncludes('PLUS', 'DATA_IMPORT')).toBe(true);
    expect(planIncludes('PLUS', 'MEMBER_LOGINS')).toBe(true);

    expect(planIncludes('FREE', 'FULL_HISTORY')).toBe(false);
    expect(planIncludes('FREE', 'DATA_IMPORT')).toBe(false);
    expect(planIncludes('FREE', 'MEMBER_LOGINS')).toBe(false);
  });

  // ⚠️ The auth snapshot outlives a deploy, so a bundle WILL be handed a tier name it predates.
  // Failing closed there strips paid features from a paying household for as long as the tab is
  // open; failing open costs one doomed round trip the server refuses with a message.
  it('fails OPEN for a tier name this bundle has never heard of', () => {
    expect(planIncludes('TEAM', 'MEMBER_LOGINS')).toBe(true);
    expect(planIncludes('SOMETHING_ENTIRELY_NEW', 'DATA_IMPORT')).toBe(true);
  });

  it('gives Pro everything Plus has', () => {
    for (const feature of PLAN_FEATURES.PLUS) {
      expect(planIncludes('PRO', feature)).toBe(true);
    }
  });

  // A snapshot written before billing shipped carries no plan at all. Same direction, same reason.
  it('fails OPEN when there is no plan at all', () => {
    expect(planIncludes(undefined, 'FULL_HISTORY')).toBe(true);
    expect(planIncludes(null, 'DATA_IMPORT')).toBe(true);
  });

  it('answers false for a feature a known plan does not hold, not merely for FREE', () => {
    expect(planIncludes('FREE', 'A_FEATURE_THAT_DOES_NOT_EXIST')).toBe(false);
  });
});

describe('isKnownPlan', () => {
  // The one place the answer is "render nothing" rather than "fail open": PlanBadge names the plan
  // on screen, and there is no safe way to name one you do not recognise.
  it('recognises exactly the plans in the map', () => {
    expect(isKnownPlan('FREE')).toBe(true);
    expect(isKnownPlan('PLUS')).toBe(true);
    expect(isKnownPlan('PRO')).toBe(true);
    expect(isKnownPlan('TEAM')).toBe(false);
    expect(isKnownPlan(undefined)).toBe(false);
    expect(isKnownPlan(null)).toBe(false);
  });

  // A plain object lookup would answer true for 'toString', 'constructor' and friends, which is how
  // a badge ends up rendering for a plan that does not exist.
  it('is not fooled by inherited Object properties', () => {
    expect(isKnownPlan('toString')).toBe(false);
    expect(isKnownPlan('constructor')).toBe(false);
  });
});

describe('isPaidPlan', () => {
  it('separates Free from the paid tiers', () => {
    expect(isPaidPlan('FREE')).toBe(false);
    expect(isPaidPlan('PLUS')).toBe(true);
  });

  // Forward-compatible: every tier added after FREE is a paid one.
  it('treats Pro and an unrecognised tier name alike as paid', () => {
    expect(isPaidPlan('PRO')).toBe(true);
    expect(isPaidPlan('TEAM')).toBe(true);
  });

  // ⚠️ DIFFERENT from planIncludes, deliberately. BillingTab picks between "you have Plus" and
  // "here is what Plus costs" on this; answering true for a household we know nothing about shows
  // the paid summary to somebody who has never paid, and hides the control that lets them.
  it('answers false when there is no plan at all', () => {
    expect(isPaidPlan(undefined)).toBe(false);
    expect(isPaidPlan(null)).toBe(false);
  });
});

describe('the map itself', () => {
  // Mirrors PlanFeatureMappingTest's assertion on the backend. If these two ever disagree the
  // client offers a control the server refuses, or hides one it would have allowed.
  it('grants FREE nothing and PLUS exactly the three paid features', () => {
    expect(PLAN_FEATURES.FREE).toEqual([]);
    expect([...PLAN_FEATURES.PLUS].sort()).toEqual(
      ['DATA_IMPORT', 'FULL_HISTORY', 'MEMBER_LOGINS'].sort(),
    );
  });

  // A paid tier that dropped something a cheaper one has would present as a household paying more
  // and getting less -- the backend builds PRO's set FROM Plus's for exactly this reason.
  it('never lets a higher tier hold fewer features than Plus', () => {
    for (const feature of PLAN_FEATURES.PLUS) {
      expect(PLAN_FEATURES.PRO).toContain(feature);
    }
  });
});
