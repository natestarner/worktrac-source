import { describe, it, expect } from 'vitest';
import { getMuscles } from 'js-rich-body-highlighter';
import { DRAWN, REGISTRY, viewFor } from './bodyMapArt';
import { MUSCLES } from '../../utils/muscles';

describe('the drawn muscles', () => {
  // `drawn` in the vocabulary is a promise that the body diagram can shade the muscle. If the art
  // and the vocabulary disagree, a muscle is either listed as drawn and silently never shaded, or
  // shaded but described as text-only.
  it('are exactly the vocabulary muscles marked drawn', () => {
    expect([...DRAWN].sort()).toEqual(MUSCLES.filter((m) => m.drawn).map((m) => m.code).sort());
  });

  it('each have an outline on both bodies', () => {
    for (const gender of ['male', 'female']) {
      const groups = new Set([
        ...getMuscles(gender, 'front', REGISTRY).map((m) => m.group),
        ...getMuscles(gender, 'back', REGISTRY).map((m) => m.group),
      ]);
      for (const code of DRAWN) {
        expect(groups.has(code), `${gender} body has no outline for ${code}`).toBe(true);
      }
    }
  });
});

describe('viewFor (the strip thumbnail side)', () => {
  it('shows the back for a back-first exercise and the front otherwise', () => {
    expect(viewFor(['lats', 'upper_back'])).toBe('back');
    expect(viewFor(['chest'])).toBe('front');
    // Text-only muscles are skipped when choosing; nothing drawable falls back to the front.
    expect(viewFor(['cardio', 'hamstrings'])).toBe('back');
    expect(viewFor([])).toBe('front');
  });
});
