import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listenForAppLinks } from '../../lib/native';

// Sends a link that opened the App Store app (a universal link) to its screen. Mounted once in
// App.jsx beside ServiceWorkerUpdater, inside the router and outside every route, so it works on
// /join for someone signed out as well as on /app/* for someone signed in. On the web it never
// listens: the browser has already loaded the URL. Renders nothing; it is not a route.
export default function AppLinkRouter() {
  const navigate = useNavigate();
  useEffect(() => listenForAppLinks((path) => navigate(path)), [navigate]);
  return null;
}
