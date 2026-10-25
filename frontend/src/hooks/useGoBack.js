import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// What a screen's "← Back" link does: the previous screen, or Log when there is none.
//
// navigate(-1) alone does nothing when this screen is the first entry in the tab's history, and
// that is ordinary in the App Store app: iOS kills a backgrounded app, the next launch reopens the
// screen it was on, and there is no browser back button to fall back on -- so Back on Profile or
// Billing was a dead control. On the web it is a fresh tab, or a reload, of a deep link; there it
// used to leave Huddle (or do nothing), and landing on Log keeps the person in the app instead.
//
// React Router's <BrowserRouter> numbers its own history entries in `history.state.idx`, starting
// at 0 for the entry the document loaded on. Anything else (no state at all) is treated as "nothing
// to go back to", which is the direction that can't strand anyone.
export function useGoBack(fallback = '/app/log') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = window.history.state?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
