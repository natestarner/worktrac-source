import { beforeEach, describe, expect, it } from 'vitest';
import { isHistoryReload, resetHistoryReloadForTest, takeHistoryReload } from './historyReload';

const ORIGIN = 'https://app.huddle.fitness';
// The navigation entry's `name` is deliberately NOT the page's URL here: what Safari reports when the
// service worker answered the navigation (#431). Only `type` may decide anything.
const entry = (type) => ({ type, name: `${ORIGIN}/index.html` });
const at = (path) => `${ORIGIN}${path}`;

describe('isHistoryReload', () => {
  it('is a reload of the History tab', () => {
    expect(isHistoryReload(entry('reload'), at('/app/history'))).toBe(true);
    expect(isHistoryReload(entry('reload'), at('/app/history/'))).toBe(true);
    expect(isHistoryReload(entry('reload'), at('/app/history?x=1'))).toBe(true);
  });

  // #431: Safari names a worker-served navigation after the RESPONSE (`/index.html`), so reading the
  // entry's name never matched there and a reload on History silently did an ordinary sync.
  it('goes by the URL the page was loaded at, not the navigation entry name', () => {
    expect(isHistoryReload({ type: 'reload', name: at('/index.html') }, at('/app/history'))).toBe(true);
    expect(isHistoryReload({ type: 'reload', name: at('/app/history') }, at('/app/log'))).toBe(false);
  });

  // Only a reload the person made ON History. Opening the app, following a link, going Back, or
  // reloading another tab is not a request for the whole History.
  it('is nothing else', () => {
    expect(isHistoryReload(entry('navigate'), at('/app/history'))).toBe(false);
    expect(isHistoryReload(entry('back_forward'), at('/app/history'))).toBe(false);
    expect(isHistoryReload(entry('reload'), at('/app/log'))).toBe(false);
    expect(isHistoryReload(entry('reload'), at('/app/history-extra'))).toBe(false);
    expect(isHistoryReload(undefined, at('/app/history'))).toBe(false);
    expect(isHistoryReload(entry('reload'), 'not a url')).toBe(false);
  });
});

describe('takeHistoryReload', () => {
  beforeEach(() => resetHistoryReloadForTest());

  // History remounts on a person switch and on every return to the tab; only the first mount after
  // the reload is the one the person asked for.
  it('answers yes once per page load', () => {
    expect(takeHistoryReload(entry('reload'), at('/app/history'))).toBe(true);
    expect(takeHistoryReload(entry('reload'), at('/app/history'))).toBe(false);
  });

  // Reloaded on Log, then switched to History: the address bar says /app/history by the time History
  // mounts. The URL captured when the page LOADED is what counts.
  it('goes by the URL the page was loaded at, not where it is now', () => {
    window.history.replaceState(null, '', '/app/history');
    expect(takeHistoryReload(entry('reload'), at('/app/log'))).toBe(false);
  });

  it('is spent by the first ask even when that answer was no', () => {
    expect(takeHistoryReload(entry('navigate'), at('/app/history'))).toBe(false);
    expect(takeHistoryReload(entry('reload'), at('/app/history'))).toBe(false);
  });
});
