import { describe, it, expect } from 'vitest';
import { aboutLabel, pickedSummary, primaryLine } from './muscleText';

describe('aboutLabel', () => {
  it('names the main and helping muscles', () => {
    expect(aboutLabel({ primary: ['chest'], secondary: ['shoulders', 'triceps'] })).toBe(
      'About this exercise: works Chest, helped by Shoulders and Triceps',
    );
  });

  it('is the bare name when nothing is listed', () => {
    expect(aboutLabel({ primary: [], secondary: [] })).toBe('About this exercise');
  });

  // Playwright matches accessible names by substring, so a new control on the Log screen must not
  // contain an existing label, nor be contained by one.
  it('collides with no other label on the Log screen', () => {
    const others = ['Add to favorites', 'Remove from favorites', 'Add a note for this session', 'Edit note for this session', 'Customize this exercise', 'Log set'];
    const label = aboutLabel({ primary: ['chest'], secondary: [] });
    for (const other of others) {
      expect(label.toLowerCase().includes(other.toLowerCase())).toBe(false);
      expect(other.toLowerCase().includes('about this exercise')).toBe(false);
    }
  });
});

describe('primaryLine', () => {
  it('lists main muscles only, dropping codes this build does not know', () => {
    expect(primaryLine({ primary: ['quads', 'glutes', 'serratus'], secondary: ['hamstrings'] })).toBe('Quads, Glutes');
  });
});

describe('pickedSummary', () => {
  it('names the primary muscles, then the helpers, in the About sheet words', () => {
    expect(pickedSummary({ primary: ['chest'], secondary: ['shoulders', 'triceps'] })).toBe('Chest · helped by Shoulders and Triceps');
    expect(pickedSummary({ primary: ['glutes', 'quads'], secondary: [] })).toBe('Glutes and Quads');
  });

  it('reads sensibly with only helpers, and is empty with nothing picked', () => {
    expect(pickedSummary({ primary: [], secondary: ['abs'] })).toBe('Helped by Abs');
    expect(pickedSummary({ primary: [], secondary: [] })).toBe('');
  });
});
