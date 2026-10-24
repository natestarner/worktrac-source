import { useEffect } from 'react';
import { keepFocusedFieldVisible } from '../../lib/native';

// Keeps the field being typed into above the keyboard in the App Store app. Mounted once in
// App.jsx beside AppLinkRouter, outside every route, so it covers the login screen as well as the
// app. On the web it never listens: Safari already does this. Renders nothing.
export default function FocusedFieldKeeper() {
  useEffect(() => keepFocusedFieldVisible(), []);
  return null;
}
