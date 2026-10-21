// Links that leave Huddle (Terms, Privacy, the marketing site).
//
// Web: a plain `target="_blank"` anchor, exactly as before -- new tab, middle-click, "copy link"
// and the screen reader's link semantics all keep working.
// App: a `_blank` navigation either does nothing in WKWebView or throws the person out to Safari
// mid-workout. The in-app browser sheet (SFSafariViewController) opens over the app and closes back
// to it, which is also what App Review expects for a page like the privacy policy.
import { isNativeApp } from './platform';

export async function openExternal(url) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

// Spread onto an <a>: `<a {...externalLinkProps(url)}>Terms</a>`. On the web the result has no
// onClick at all, so the anchor is the same element it always was; in the app the click is taken
// over and opened in the in-app browser.
export function externalLinkProps(url) {
  const props = { href: url, target: '_blank', rel: 'noopener noreferrer' };
  if (!isNativeApp()) return props;
  return {
    ...props,
    onClick: (event) => {
      event.preventDefault();
      // Not awaited: a click handler can't use the result, and a browser sheet that fails to open
      // leaves the person on the screen they were on, which is the honest outcome.
      openExternal(url).catch(() => {});
    },
  };
}
