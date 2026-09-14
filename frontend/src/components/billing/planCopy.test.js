import { describe, expect, it } from 'vitest';
import { PLANS, PLAN_ORDER, PRO_BANDS, PLUS_BENEFITS, planCopy } from './planCopy';
import { PLAN_FEATURES } from '../../utils/planFeatures';

// This file DESCRIBES tiers; planFeatures.js decides what they grant. Most of what follows is about
// keeping those two honest with each other, because a benefit promised here and not granted there
// is a promise broken at the point of sale.
describe('planCopy', () => {

  it('describes every tier the feature map knows about', () => {
    expect(Object.keys(PLANS).sort()).toEqual(Object.keys(PLAN_FEATURES).sort());
  });

  // ⚠️ Null, never a fallback to Free. A newer server naming a tier this bundle predates is a real
  // case, and describing it with the WRONG tier's benefits is worse than describing it with none:
  // a caller can render nothing, but it cannot detect a lie.
  it('answers null for a tier this build has never heard of', () => {
    expect(planCopy('TEAM')).toBeNull();
    expect(planCopy(undefined)).toBeNull();
  });

  // Everything Free gets is ungated, so it sells nothing -- the same reason
  // BillingPlan.FREE.features() is empty.
  it('sells Free on nothing', () => {
    expect(PLANS.FREE.benefits).toEqual([]);
  });

  // ⚠️ Export is free on every tier. Listing it as a paid benefit would be false at the exact
  // moment somebody is deciding whether to pay, and it is a standing commitment in billing.md.
  it('never sells export as a paid benefit', () => {
    for (const plan of Object.values(PLANS)) {
      for (const benefit of plan.benefits) {
        expect(benefit.label.toLowerCase()).not.toContain('export');
      }
    }
  });

  // Pro's list is the DIFFERENCE over Plus, not the whole thing. Restating Plus's lines here is how
  // the two drift apart.
  it("states Pro's additions rather than repeating Plus", () => {
    const plusLabels = PLUS_BENEFITS.map((b) => b.label);
    for (const benefit of PLANS.PRO.benefits) {
      expect(plusLabels).not.toContain(benefit.label);
    }
  });

  // ⚠️ The softened privacy claim. What shipped is ONE account-wide switch defaulting to private,
  // so copy promising per-client granularity would describe a setting that does not exist.
  it('promises privacy the product can keep', () => {
    const blurb = PLANS.PRO.blurb.toLowerCase();
    expect(blurb).toContain('private from each other');
    expect(blurb).not.toContain('each client');
  });

  it('orders the tiers cheapest first and names only what can be bought', () => {
    expect(PLAN_ORDER).toEqual(['FREE', 'PLUS', 'PRO']);
    for (const id of PLAN_ORDER) {
      expect(PLANS[id]).toBeDefined();
    }
  });
});

describe('PRO_BANDS', () => {

  it('carries a price for both intervals on every band', () => {
    for (const band of PRO_BANDS) {
      expect(band.month).toMatch(/^\$[\d,]+ \/ month$/);
      expect(band.year).toMatch(/^\$[\d,]+ \/ year$/);
    }
  });

  // The ids are the second half of a PlanSku name on the server (PRO_STUDIO_YEAR), and a mismatch
  // is a checkout that 400s on a combination we do not sell.
  it('names the bands the server sells', () => {
    expect(PRO_BANDS.map((b) => b.id)).toEqual(['STARTER', 'STUDIO', 'PRACTICE', 'UNLIMITED']);
  });

  it('rises in price as the ceiling rises', () => {
    const amounts = PRO_BANDS.map((b) => Number(b.month.replace(/[^\d]/g, '')));
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  // ⚠️ Null, not a large number. A sentinel ceiling sorts correctly and then renders to a reader as
  // a real limit -- the same trap RosterEntryDto.daysSinceLastWorkout avoids.
  it('says unlimited with null rather than a sentinel', () => {
    const unlimited = PRO_BANDS.find((b) => b.id === 'UNLIMITED');
    expect(unlimited.clients).toBeNull();
    expect(unlimited.label).not.toMatch(/\d/);
  });

  // ⚠️ A BAND IS A CEILING ON ADDING, NEVER A REVOCATION. A trainer reading "up to 15" as "we cut
  // you off at 15" is the difference between upgrading and churning, so the copy must not suggest
  // removal, locking or loss.
  it('never implies anybody gets cut off', () => {
    for (const band of PRO_BANDS) {
      expect(band.label.toLowerCase()).not.toMatch(/lock|remove|lose|cut off|max/);
    }
  });
});
