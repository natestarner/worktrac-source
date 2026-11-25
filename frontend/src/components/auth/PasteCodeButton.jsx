import { useState } from 'react';
import Button from '../shared/Button';
import { CODE_LENGTH, codeFromInput } from '../../utils/verificationCode';

// "Paste code": reads the clipboard straight into a 6-digit code field.
//
// Why a button at all (TestFlight 1.4, 2026-11-25): in the App Store app, tapping the code box
// did not bring up iOS's Paste menu. Focusing that box sets several things moving at once -- the
// app's window shrinks above the keyboard, the page re-centres its card in what is left, iOS's
// one-time-code AutoFill bar appears -- and iOS dismisses its edit menu when the field moves under
// it. This asks the clipboard directly, so pasting never depends on that menu or on the keyboard
// being up. iOS answers with its own small "Paste" bubble beside the button, which is the
// permission prompt; that is expected.
//
// Feature-detected, not platform-detected: shown wherever the browser can read the clipboard
// (Safari, Chrome, the app's WebView), absent where it cannot, which leaves the field exactly as
// it was. Typing and the edit menu still work everywhere.
export function canPasteCode() {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
}

export default function PasteCodeButton({ onCode, disabled = false }) {
  const [problem, setProblem] = useState('');
  if (!canPasteCode()) return null;

  async function paste() {
    setProblem('');
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Refused, or dismissed iOS's Paste bubble. Point at the way that always works.
      setProblem('Couldn’t read what you copied. Touch and hold the box, then choose Paste.');
      return;
    }
    const code = codeFromInput(text);
    if (code.length !== CODE_LENGTH) {
      setProblem('What you copied isn’t a 6-digit code. Copy the code from the email and try again.');
      return;
    }
    onCode(code);
  }

  return (
    <div style={{ textAlign: 'center', margin: 'var(--space-2) 0 var(--space-3)' }}>
      <Button type="button" variant="ghost" size="sm" onClick={paste} disabled={disabled}>
        Paste code
      </Button>
      {problem && (
        <div role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }}>
          {problem}
        </div>
      )}
    </div>
  );
}
