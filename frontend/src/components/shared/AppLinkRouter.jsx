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
  useEffect(() => listenForAppLinks((path) => navigateRef.current(path)), []);
  return null;
}
