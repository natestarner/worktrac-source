import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listenForAppLinks } from '../../lib/native';

// Sends a link that opened the App Store app (a universal link) to its screen. Mounted once in
// App.jsx beside ServiceWorkerUpdater, inside the router and outside every route, so it works on
// /join for someone signed out as well as on /app/* for someone signed in. On the web it never
// listens: the browser has already loaded the URL. Renders nothing; it is not a route.
//
// Subscribes ONCE, reaching navigate through a ref. Under <BrowserRouter> navigate is a new function
// on every pathname change, so with [navigate] as the dependency every tab tap re-subscribed and
// re-read the launch URL -- after an App Store checkout, that sent each tap straight back to the
// billing screen (2026-10-24).
export default function AppLinkRouter() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(
    () =>
      listenForAppLinks((path) => {
        navigateRef.current(path);
        // #434: a heartbeat for 15s after the link -- the clock time, how late the timer fired, the
        // URL, and the tab actually drawn. On 2026-10-31 the page froze after iOS's prompt and its
        // lines were written late, reading as "on Billing at +1s" while History stayed on screen. A
        // frozen page shows here as a burst of beats, each seconds late. Remove with appLinks.js's
        // logging once that issue is settled.
        const start = performance.now();
        for (let s = 1; s <= 15; s += 1) {
          setTimeout(() => {
            const late = Math.round(performance.now() - start - s * 1000);
            const tab = document.querySelector('[aria-current="page"]')?.textContent ?? '-';
            console.info(
              `[appLinks] +${s}s`,
              new Date().toISOString(),
              `late=${late}ms`,
              window.location.pathname + window.location.search,
              `tab=${tab}`,
            );
          }, s * 1000);
        }
      }),
    [],
  );
  return null;
}
