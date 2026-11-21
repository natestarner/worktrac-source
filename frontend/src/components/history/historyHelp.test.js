import { describe, expect, it } from 'vitest';
import { RECORD_BADGES_HELP } from './historyHelp';
import { prSpec, SET_PR_TYPES, SESSION_PR_TYPES } from '../trends/exerciseMetrics';

describe('RECORD_BADGES_HELP', () => {
  // The key on History shows each celebrated record's badgeLabel beside its glyph; the sheet behind
  // its "?" must name the same records in the same words, or the two describe different things.
  it('explains every badge the key shows, by the name the key gives it', () => {
    const text = RECORD_BADGES_HELP.lines.join(' ');
    for (const type of [...SET_PR_TYPES, ...SESSION_PR_TYPES]) {
      expect(text).toContain(`${prSpec(type).badgeLabel}:`);
    }
  });

  it('keeps the former link text as its accessible name and links on to the handbook section', () => {
    expect(RECORD_BADGES_HELP.label).toBe('How records work');
    // Section ids are API (user-facing-help.md); "history" is one of them.
    expect(RECORD_BADGES_HELP.more.to).toBe('/app/help#history');
  });
});
