import { describe, expect, it } from 'vitest';
import { TOUR_ANCHORS, TOUR_STEPS } from './tourSteps';

// Pinned as a literal, same reasoning as HelpTab.test.jsx's SECTION_IDS: deriving this from
// App.jsx's route table would make the test agree with any typo instead of catching it.
const REAL_APP_ROUTES = [
  '/app/log',
  '/app/history',
  '/app/prs',
  '/app/routines',
  '/app/trends',
  '/app/settings',
  '/app/profile',
  '/app/help',
  '/app/contact',
];

describe('TOUR_STEPS', () => {
  it('has exactly nine steps', () => {
    expect(TOUR_STEPS).toHaveLength(9);
  });

  it('gives every step a unique id, in a stable order', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'log-tab',
      'people-bar',
      'exercise-search',
      'add-exercise',
      'set-entry',
      'log-set',
      'customize-exercise',
      'new-routine',
      'account-menu',
    ]);
  });

  // A typo in either tourSteps.js or the component carrying the matching data-tour-anchor
  // attribute is otherwise a silent no-spotlight with no error anywhere.
  it("anchors every step at a value actually declared in TOUR_ANCHORS", () => {
    const declared = new Set(Object.values(TOUR_ANCHORS));
    for (const step of TOUR_STEPS) {
      expect(declared.has(step.anchor), `${step.id} anchors an undeclared value: ${step.anchor}`).toBe(true);
    }
  });

  it('gives every step a non-empty title and body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim(), `${step.id} has an empty title`).not.toBe('');
      expect(step.body.trim(), `${step.id} has an empty body`).not.toBe('');
    }
  });

  // Mirrors chartHelp.test.js's mutual-non-containment check: "Step N of 9" is rendered beside the
  // title, so two titles that overlap as substrings would make a Playwright getByText/getByRole
  // selector for one step ambiguous with another.
  it('keeps every title mutually non-containing', () => {
    const titles = TOUR_STEPS.map((s) => s.title);
    for (const a of titles) {
      for (const b of titles) {
        if (a !== b) expect(b.toLowerCase()).not.toContain(a.toLowerCase());
      }
    }
  });

  // Steps 5-7 (set-entry, log-set, customize-exercise) are the only ones that need an exercise
  // open on screen; every other step arranges the picker.
  it('declares exercise: "open" for steps 5-7 only', () => {
    const openIds = new Set(['set-entry', 'log-set', 'customize-exercise']);
    for (const step of TOUR_STEPS) {
      expect(step.screen.exercise).toBe(openIds.has(step.id) ? 'open' : 'none');
    }
  });

  it('points every step at a route that actually exists', () => {
    for (const step of TOUR_STEPS) {
      expect(REAL_APP_ROUTES, `${step.id} points at an unknown route: ${step.screen.route}`).toContain(step.screen.route);
    }
  });
});
