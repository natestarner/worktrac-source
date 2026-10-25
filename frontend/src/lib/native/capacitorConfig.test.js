import { describe, expect, it } from 'vitest';
import config from '../../../capacitor.config.json';

// The WebView settings the app ships with. Each is a place where Capacitor's default makes the app
// behave unlike the web, so the reason for each value is written beside its assertion.
describe('capacitor.config.json', () => {
  // WKWebView's default previews a link on long press, and the tab bar is made of links: a long press
  // on History showed a preview of an internal capacitor://localhost page. Safari's preview of a real
  // web page is reasonable; the app's of itself is not.
  it('turns off long-press link previews', () => {
    expect(config.ios?.allowsLinkPreview).toBe(false);
  });

  // native-apps.md: it changes fetch's abort, timeout and CORS behaviour on one platform only.
  it('keeps CapacitorHttp off', () => {
    expect(config.plugins.CapacitorHttp.enabled).toBe(false);
  });
});
