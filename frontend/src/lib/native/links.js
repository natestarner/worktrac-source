// Links that leave Huddle (Terms, Privacy, the marketing site).
//
// Web: a plain `target="_blank"` anchor, exactly as before -- new tab, middle-click, "copy link"
// and the screen reader's link semantics all keep working.
// App: a `_blank` navigation either does nothing in WKWebView or throws the person out to Safari
// mid-workout. The in-app browser sheet (SFSafariViewController) opens over the app and closes back
// to it, which is also what App Review expects for a page like the privacy policy.
import { isNativeApp } from './platform';

//
// `onClose` runs when the person dismisses the sheet, which is the only sign they came back: the
// sheet never takes the app out of the foreground, so nothing keyed on `visibilitychange` (TanStack's
// refetch-on-focus included) notices. On the web it never runs -- returning to the tab already fires
// that event, which is what the web's refetch-on-focus answers.
export async function openExternal(url, { onClose } = {}) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  let listener = null;
  if (onClose) {
    listener = await Browser.addListener('browserFinished', () => {
      listener?.remove();
      onClose();
    });
  }
  try {
    await Browser.open({ url });
  } catch (error) {
    // Never opened, so it will never finish: don't leave a listener waiting for a sheet that isn't there.
    listener?.remove();
    throw error;
  }
}

// Leaves the app for the phone's own browser (Safari), for a page the person finishes OUTSIDE the
// app -- today only the App Store app's hosted Stripe checkout. Not the in-app sheet above, for two
// reasons: closing a sheet never takes the app out of the foreground, so useCheckoutResume (which
// confirms the payment on `visibilitychange`) would never notice they came back; and Apple's US
// rules are about linking OUT to a web checkout, which Safari unambiguously is.
// Web: the same new tab as openExternal's web branch.
export async function openInBrowser(url) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { AppLauncher } = await import('@capacitor/app-launcher');
  await AppLauncher.openUrl({ url });
}

// Spread onto an <a>: `<a {...externalLinkProps(url)}>Terms</a>`. On the web the result has no
// onClick at all, so the anchor is the same element it always was; in the app the click is taken
// over and opened in the in-app browser.
//
// `leaveApp` opens it with the system instead (openInBrowser), for a link whose destination is
// another app: the App Store listing behind "Update the app". In the in-app sheet that is Apple's
// web preview of the listing, one more tap short of the App Store; handed to iOS, it opens the App
// Store itself. The web branch is the same new-tab anchor either way.
export function externalLinkProps(url, { leaveApp = false } = {}) {
  const props = { href: url, target: '_blank', rel: 'noopener noreferrer' };
  if (!isNativeApp()) return props;
  return {
    ...props,
    onClick: (event) => {
      event.preventDefault();
      // Not awaited: a click handler can't use the result, and a browser sheet that fails to open
      // leaves the person on the screen they were on, which is the honest outcome.
      (leaveApp ? openInBrowser(url) : openExternal(url)).catch(() => {});
    },
  };
}
