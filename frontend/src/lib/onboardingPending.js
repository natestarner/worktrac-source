// Armed at email confirmation (see AuthContext.confirmEmail) so a brand-new account's very first
// login shows the welcome modal exactly once. New registrations only -- an existing account starts
// the tour from the Help tab's "Take the tour" button instead. Keyed by accountId so a shared
// device with more than one household on it never shows the wrong household's welcome modal.
//
// Every access try/catch-swallows: private mode and quota must degrade to "no welcome modal", and
// this must NEVER throw into confirmEmail -- a failed write here must not fail the registration
// flow itself. Same shape as lib/endedSessions.js / lib/authSnapshot.js.
const KEY_PREFIX = 'worktrac-onboarding-pending-';

function keyFor(accountId) {
  return `${KEY_PREFIX}${accountId}`;
}

export function markOnboardingPending(accountId) {
  if (accountId == null) return;
  try {
    localStorage.setItem(keyFor(accountId), '1');
  } catch {
    // Losing the flag just means this account never sees the welcome modal -- never a hard
    // dependency for anything else registration does.
  }
}

export function isOnboardingPending(accountId) {
  if (accountId == null) return false;
  try {
    return localStorage.getItem(keyFor(accountId)) === '1';
  } catch {
    return false;
  }
}

// Cleared once the welcome modal has been shown and answered either way ("Show me around" or "Not
// now") -- an existing account replaying the tour later goes through Help's button, never through
// this flag again.
export function clearOnboardingPending(accountId) {
  if (accountId == null) return;
  try {
    localStorage.removeItem(keyFor(accountId));
  } catch {
    // ignore
  }
}
