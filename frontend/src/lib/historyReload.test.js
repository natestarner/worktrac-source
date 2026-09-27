import { beforeEach, describe, expect, it } from 'vitest';
import { isHistoryReload, resetHistoryReloadForTest, takeHistoryReload } from './historyReload';

const entry = (type, path) => ({ type, name: `https://app.huddle.fitness${path}` });

describe('isHistoryReload', () => {
  it('is a reload of the History tab', () => {
    expect(isHistoryReload(entry('reload', '/app/history'))).toBe(true);
    expect(isHistoryReload(entry('reload', '/app/history/'))).toBe(true);
    expect(isHistoryReload(entry('reload', '/app/history?x=1'))).toBe(true);
  });

  // Only a reload the person made ON History. Opening the app, following a link, going Back, or
  // reloading another tab is not a request for the whole History.
  it('is nothing else', () => {
    expect(isHistoryReload(entry('navigate', '/app/history'))).toBe(false);
    expect(isHistoryReload(entry('back_forward', '/app/history'))).toBe(false);
    expect(isHistoryReload(entry('reload', '/app/log'))).toBe(false);
    expect(isHistoryReload(entry('reload', '/app/history-extra'))).toBe(false);
    expect(isHistoryReload(undefined)).toBe(false);
    expect(isHistoryReload({ type: 'reload', name: 'not a url' })).toBe(false);
  });
});

describe('takeHistoryReload', () => {
  beforeEach(() => resetHistoryReloadForTest());

  // History remounts on a person switch and on every return to the tab; only the first mount after
  // the reload is the one the person asked for.
  it('answers yes once per page load', () => {
    expect(takeHistoryReload(entry('reload', '/app/history'))).toBe(true);
    expect(takeHistoryReload(entry('reload', '/app/history'))).toBe(false);
  });

  // Reloaded on Log, then switched to History: the History chunk may only load now, when the address
  // bar already says /app/history. The load's own URL is what counts.
  it('goes by the URL the page was loaded at, not where it is now', () => {
    window.history.replaceState(null, '', '/app/history');
    expect(takeHistoryReload(entry('reload', '/app/log'))).toBe(false);
  });

  it('is spent by the first ask even when that answer was no', () => {
    expect(takeHistoryReload(entry('navigate', '/app/history'))).toBe(false);
    expect(takeHistoryReload(entry('reload', '/app/history'))).toBe(false);
  });
});
