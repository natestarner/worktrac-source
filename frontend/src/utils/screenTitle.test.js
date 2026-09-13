import { describe, expect, it } from 'vitest';
import { screenTitleFor } from './screenTitle';

describe('screenTitleFor', () => {
  it('names each tab', () => {
    expect(screenTitleFor('/app/log')).toBe('Log');
    expect(screenTitleFor('/app/history')).toBe('History');
    expect(screenTitleFor('/app/routines')).toBe('Routines');
    expect(screenTitleFor('/app/trends')).toBe('Trends');
  });

  it('names the account-menu screens', () => {
    expect(screenTitleFor('/app/settings')).toBe('App settings');
    expect(screenTitleFor('/app/profile')).toBe('Profile');
    expect(screenTitleFor('/app/contact')).toBe('Contact us');
  });

  // Spoken aloud, so "PRs" becomes "P R s" and "&" becomes "ampersand".
  it('spells out what a screen reader would mangle', () => {
    expect(screenTitleFor('/app/prs')).toBe('Personal records');
    expect(screenTitleFor('/app/billing')).toBe('Plan and billing');
  });

  // THE REGRESSION. HelpTab renders its own visible <h1>Huddle Handbook</h1>. The first cut of the
  // map listed '/app/help' too, so AppShell added a visually hidden h1 with the same text directly
  // above it -- announced twice by a screen reader, and `strict mode violation: ... resolved to 2
  // elements` for the two Handbook e2e specs, which failed all three attempts against lower.
  it('returns null for a screen that renders its own h1', () => {
    expect(screenTitleFor('/app/help')).toBeNull();
  });

  // Specifically NOT the 'Huddle' fallback: returning any string here still renders a second h1,
  // so deleting the entry from TITLES would not have fixed the bug.
  it('returns null rather than the fallback for a nested Handbook route', () => {
    expect(screenTitleFor('/app/help/offline')).toBeNull();
  });

  it('resolves a nested route to its section', () => {
    expect(screenTitleFor('/app/settings/units')).toBe('App settings');
  });

  it('falls back for an unknown or missing path', () => {
    expect(screenTitleFor('/app/nowhere')).toBe('Huddle');
    expect(screenTitleFor('')).toBe('Huddle');
    expect(screenTitleFor(undefined)).toBe('Huddle');
  });
});
