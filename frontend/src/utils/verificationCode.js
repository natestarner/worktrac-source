// What a typed or pasted verification code becomes: its digits, at most six.
//
// The emailed code is drawn as two groups ("123 456", templates/email/verification-code.html), so a
// copied code often carries the gap, or the sentence around it. The fields therefore set NO
// maxLength: the browser applies maxLength to a paste before the app sees it, so "123 456" arrived
// as "12345" and "Your code is 123456" as "" (TestFlight 1.4, 2026-11-25). Digits first, then six.
export const CODE_LENGTH = 6;

export function codeFromInput(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);
}
