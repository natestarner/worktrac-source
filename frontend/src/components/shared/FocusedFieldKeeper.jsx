import { useEffect } from 'react';
import { keepFocusedFieldVisible } from '../../lib/native';
import { trackVisibleViewport } from '../../lib/visibleViewport';

// Keeps the field being typed into visible above the keyboard. Mounted once in App.jsx beside
// AppLinkRouter, outside every route, so it covers the login screen as well as the app. Renders
// nothing.
//   - trackVisibleViewport (every platform): publishes the part of the screen the keyboard leaves
//     visible, which every Modal sizes itself to, and reveals a focused field inside a dialog.
//   - keepFocusedFieldVisible (the App Store app only): reveals a focused field on the page. On the
//     web it never listens: Safari already does this.
export default function FocusedFieldKeeper() {
  useEffect(() => trackVisibleViewport(), []);
  useEffect(() => keepFocusedFieldVisible(), []);
  return null;
}
