# A real invite email's link silently landed on the login screen (2026-09-08)

- User testing the member-logins feature in lower, as an owner on Pro: "I get the email, but
  when I click on it, it just takes me to the login page — I'm not sure what I'm supposed to do
  at that point?" No error, no console signal from the user's side — just the wrong screen.
- Root cause: `EmailService.joinUrl()` built the link as `appUrl + "/join?i=...&t=..."`, on the
  assumption that `appUrl` (`APP_EMAIL_APP_URL`) is a bare origin. It is not, in any real
  environment — confirmed live via `az containerapp show` (read-only): lower carries
  `https://app.dev.huddle.fitness/app/log`, production carries `https://app.huddle.fitness/app/log`.
  Both already have a full "open the app" path on them, chosen for the *other* callers
  (`sendRegistrationSuccess`, `sendAddedToHousehold`, `sendLoginRevoked`) that use `appUrl` bare
  and just want to open the app somewhere reasonable. Concatenating `/join?...` onto that produced
  `.../app/log/join?...`, which no client-side route matches. `App.jsx`'s catch-all
  (`<Route path="*" element={<Navigate to="/" replace />} />`) sent it to `/` → `/app/log` →
  (unauthenticated, since the recipient had no session yet) `ProtectedRoute`'s redirect to
  `/login` — with nothing on screen to say why, because from the router's point of view this was
  an ordinary unauthenticated visit to an unknown URL, not an error.
- The same bug independently broke `sendInviteAccepted`'s "Review logins" CTA
  (`appUrl + "/app/profile"`), the email that tells the OWNER someone accepted an invite.
- **Why nothing caught it sooner:** every backend email test either mocks `EmailService` away
  entirely or (`EmailServiceE2eNoopTest`) configures `appUrl` and never asserts on `joinUrl()`'s
  output. `logoUrlFrom()` had already solved the general problem correctly (strip the path,
  keep scheme+authority) for the logo image, but that pattern was never generalized to the two
  newer callers that also build their own path — each was written independently, against a
  mental model of `appUrl` as a bare origin that the actual deployed config had never matched.
  This is the same shape of gap the member-logins QA checklist calls out for the email pipeline
  generally: "Every automated test mocks the mail client, so nothing in CI can prove a real
  message leaves" — here, nothing proved the link *inside* that message actually resolved to
  anything.
- **Fix:** `EmailService` now derives one `appOrigin` field (scheme + authority only) in its
  constructor, and every caller building its own path (`joinUrl`, `sendInviteAccepted`'s CTA)
  uses that instead of bare `appUrl`. `EmailServiceJoinUrlTest` is deliberately built with
  `appUrl` carrying a path, matching the real deployed shape — a test against a bare origin would
  never have caught this, which is presumably why it shipped unnoticed through every phase's
  review of the member-logins feature.
- **Takeaway:** a config property with more than one plausible shape needs its ambiguity resolved
  in code, not in the value someone happens to set — a bare origin and a "default open-here" link
  look identical in `application.yml`, and the property's own name (`app-url`) doesn't say which
  one it is. See `.claude/rules/registration-and-email.md`'s new bullet: any future email CTA that
  appends its own path must build on `appOrigin`, never bare `appUrl`.
