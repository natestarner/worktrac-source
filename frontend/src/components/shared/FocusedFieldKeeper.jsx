import { useEffect } from 'react';
import { keepFocusedFieldVisible } from '../../lib/native';

// Keeps a field being typed into on the PAGE visible above the keyboard, in the App Store app only:
// the keyboard plugin removes WKWebView's own reveal, so lib/native/keyboard.js does it. On the web
// it never listens: Safari already does this. Mounted once in App.jsx beside AppLinkRouter, outside
// every route, so it covers the login screen as well as the app. Renders nothing.
//
// Dialogs follow the keyboard on their own: each open Modal tracks the visible viewport onto its
// own scrim (lib/visibleViewport.js). That used to start here, app-wide, publishing on the root
// element -- which restyled the whole page on every keyboard frame. Don't move it back.
export default function FocusedFieldKeeper() {
  useEffect(() => keepFocusedFieldVisible(), []);
  return null;
}
