# Entering the wrong current password on Change Password signed the person out (2026-09-09)

- Reported live: "whenever changing a password, whenever you enter a wrong password, it just
  kicks you straight to the login page." Reproduced by opening Profile → Change, typing the
  wrong **current** password, and submitting — instead of the inline "That isn't your current
  password." toast `ChangePasswordSection.jsx` is written to show, the app tore the session down
  and landed on `/login`.
- **Root cause:** `PasswordChangeService.changePassword` threw `UnauthorizedException` (401) for
  a wrong current password. `POST /api/user/password` is only ever reachable WITH a valid session
  token — `@RequiresPermission(CHANGE_OWN_PASSWORD)` guarantees that before the handler runs — but
  `api/client.js`'s 401 handling doesn't know that this particular authenticated route can also
  fail for a reason unrelated to the token: `if (response.status === 401 && hadToken)` treats
  **any** 401 on a token-bearing request as "the session itself is invalid", clears the token,
  fires the unauthorized handler (which navigates to `/login`), and replaces whatever message the
  server sent with a generic "Session expired". The person's session was never actually invalid —
  it was the *second* credential this one endpoint asks for (the current password) that didn't
  check out, and 401 is reserved codebase-wide for the first kind of failure.
- The sibling check three lines above it — too many wrong attempts — had already made exactly
  this call correctly: `LockedException` answers **423**, not 401, specifically so it doesn't
  collide with the session-invalidation path. The wrong-password branch was the one case in this
  method that hadn't gotten the same treatment.
- **Fix:** wrong current password now throws `ForbiddenException` (403) instead. 403 reaches
  `useGatedMutation`'s `showServerMessage` path unmolested — the person sees "That isn't your
  current password." in place, the modal stays open, and nothing about their session changes.
- **Takeaway:** on an authenticated route, 401 must mean "this token is no longer valid," full
  stop — `api/client.js` treats it that bluntly by design, with no per-route override, and that is
  the right default everywhere except a route that deliberately checks a second credential of its
  own. Any future endpoint doing the same (a second password/PIN/confirmation check while already
  signed in) needs a status code other than 401 for that check's failure — 403 is the established
  choice, and `LockedException`'s 423 alongside it shows the pattern was already half-applied
  here. See the invariant in `.claude/rules/backend-core.md`'s "Error handling" section.
