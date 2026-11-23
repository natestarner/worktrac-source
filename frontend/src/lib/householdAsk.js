// "Who else trains with you?" on the workout-done sheet, answered "Just me".
//
// Without an answer that sticks, someone who trains alone was asked after every workout, forever,
// with "Add a person" as the sheet's main button -- the nagging a polished app must not do. Adding
// a second person answers it too, but that needs nothing stored: the household then has two.
//
// Keyed by accountId, the same shape as lib/onboardingPending.js, so a shared device with more than
// one household on it keeps each one's answer. Device-local by design: the worst case is being
// asked once more on a new device, which is a fair question to ask again. Every access
// try/catch-swallows -- private mode or a full quota degrades to "ask again", never to a throw into
// the sheet.
const KEY_PREFIX = 'huddle-household-ask-declined-';

export function isHouseholdAskDeclined(accountId) {
  if (accountId == null) return false;
  try {
    return localStorage.getItem(`${KEY_PREFIX}${accountId}`) === '1';
  } catch {
    return false;
  }
}

export function declineHouseholdAsk(accountId) {
  if (accountId == null) return;
  try {
    localStorage.setItem(`${KEY_PREFIX}${accountId}`, '1');
  } catch {
    // Losing the answer only means being asked again.
  }
}
