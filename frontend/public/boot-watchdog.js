/*
 * Last-resort boot watchdog. Deliberately NOT part of the React bundle, and deliberately NOT a
 * module -- it is a plain, dependency-free script so it can still run and show something when the
 * React app itself never gets the chance to: a crash during module evaluation (before React ever
 * calls render), a throw inside a useEffect (React error boundaries do not catch those), or the
 * main bundle failing to load at all. React's own three-boundary system (App.jsx, AppShell.jsx --
 * see frontend-core.md) is the FIRST line of defense and covers render-time throws well; this is
 * the backstop for the failure classes that system structurally cannot catch, because it makes no
 * assumption about React having run at all.
 *
 * Historical context this exists to close: #202 (2026-08-25) added the first of those three
 * boundaries after a report of "the app paints, then goes white" on lower with no way back except
 * manually typing the login URL. That fix's own commit message says it plainly -- "This does NOT
 * identify what threw... What is fixed here is that the failure was invisible and unrecoverable,
 * not its cause." The same shape was hit again on 2026-08-31, after a service-worker update
 * prompt + reload, still with no visible way out. This script's whole job is to make "no visible
 * way out" impossible regardless of what the underlying cause turns out to be.
 *
 * Mechanism: poll whether #root has ever painted anything. React never legitimately empties an
 * already-populated root during ordinary operation (reconciliation only ever patches children in
 * place) -- the only way it goes from populated back to empty is an error escaping every boundary,
 * which unmounts the whole tree. So "root has no children, GRACE_MS after load" is a reliable
 * signal with no known false-positive path, in every connectivity condition: even a cold, fully
 * offline boot paints AppShellSkeleton (real chrome) within a second or two, long before the grace
 * window elapses -- see AppShellSkeleton's own comment on that boot-chrome timing.
 *
 * Loaded as a plain same-origin <script src> (not inline), so it runs under this app's
 * `script-src 'self'` CSP with no exception needed -- and keeps running even if the CSP is what's
 * blocking something else in the main bundle, since 'self' scripts are unaffected either way.
 *
 * Written in the most widely-compatible syntax on purpose (var, function declarations, no
 * arrow/template/optional-chaining): this is the fallback for when something ELSE didn't run, so
 * it must not itself be the thing an unusual browser can't parse.
 */
(function () {
  'use strict';

  // Generous on purpose. Real boot (even offline, even on a cold cache) paints something within a
  // couple of seconds -- see the comment above. This only fires for a boot that is genuinely stuck
  // or has crashed past every React boundary, not one that is merely slow.
  var GRACE_MS = 7000;
  var CHECK_INTERVAL_MS = 1000;
  var elapsedMs = 0;
  var shown = false;

  function rootHasContent() {
    var root = document.getElementById('root');
    return !!(root && root.firstChild);
  }

  function prefersDark() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function styleEl(el, rules) {
    // el.style.cssText would also work, but per-property assignment can't be broken by a stray
    // character in one value taking the whole string with it.
    for (var prop in rules) {
      if (Object.prototype.hasOwnProperty.call(rules, prop)) {
        el.style[prop] = rules[prop];
      }
    }
  }

  function showFallback() {
    if (shown) return;
    shown = true;

    var root = document.getElementById('root');
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);

    var dark = prefersDark();
    var bg = dark ? '#171614' : '#faf9f7';
    var text = dark ? '#f1efea' : '#1c1b19';
    var muted = dark ? '#a39d92' : '#6f6b62';
    var accent = '#b8552f'; // --color-accent-strong -- same literal in both themes

    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'alert');
    styleEl(wrap, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      background: bg,
      color: text,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      textAlign: 'center',
      padding: '24px',
      boxSizing: 'border-box',
      zIndex: '2147483647',
    });

    var logo = document.createElement('img');
    logo.src = '/icon.svg';
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    styleEl(logo, { width: '48px', height: '48px' });
    wrap.appendChild(logo);

    var title = document.createElement('div');
    title.textContent = "Huddle couldn't load";
    styleEl(title, { fontSize: '18px', fontWeight: '700' });
    wrap.appendChild(title);

    var body = document.createElement('div');
    body.textContent =
      "Something went wrong loading the app. Anything you've already logged is saved on this device.";
    styleEl(body, { fontSize: '14px', color: muted, maxWidth: '320px', lineHeight: '1.4' });
    wrap.appendChild(body);

    var actions = document.createElement('div');
    styleEl(actions, { display: 'flex', gap: '12px', marginTop: '4px' });

    // A real browser navigation (not client-side routing) on purpose -- if React itself is what
    // failed to start, there is no router to hand a client-side navigation to.
    var login = document.createElement('a');
    login.href = '/login';
    login.textContent = 'Go to login';
    styleEl(login, {
      background: accent,
      color: '#ffffff',
      padding: '10px 18px',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: '700',
      textDecoration: 'none',
    });
    actions.appendChild(login);

    var reload = document.createElement('a');
    reload.href = '/';
    reload.textContent = 'Reload';
    styleEl(reload, {
      background: 'transparent',
      color: text,
      padding: '10px 18px',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: '700',
      textDecoration: 'none',
      border: '1px solid ' + (dark ? '#35322c' : '#e7e3dc'),
    });
    actions.appendChild(reload);

    wrap.appendChild(actions);
    root.appendChild(wrap);
  }

  var intervalId = window.setInterval(function () {
    elapsedMs += CHECK_INTERVAL_MS;
    if (elapsedMs < GRACE_MS) return;
    if (rootHasContent()) return;
    showFallback();
    window.clearInterval(intervalId);
  }, CHECK_INTERVAL_MS);
})();
