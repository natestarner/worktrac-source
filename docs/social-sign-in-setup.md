# Sign in with Apple / Google: console setup checklist

The by-hand setup ("phase 0") that `docs/architecture/social-sign-in.md` needs before a real Apple
or Google sign-in can work on lower. Nothing here is needed for the backend's own tests, which use
the test identity provider.

**Who does what:** Nate signs in to each console. Claude can drive the browser pane through
everything except steps marked 🔑, which create or handle a secret and are Nate's alone.

Names used below (from the repo):

| Thing | Lower | Production |
|---|---|---|
| iOS bundle id | `fitness.huddle.app.lower` | `fitness.huddle.app` |
| Web app | `https://app.dev.huddle.fitness` | `https://app.huddle.fitness` |
| API | `https://api.dev.huddle.fitness` | `https://api.huddle.fitness` |
| Email sender | `DoNotReply@huddle.fitness` | same |
| Apple Team ID | `R73HV8H48W` | same |
| Privacy policy | `https://huddle.fitness/privacy.html` | same |

---

## Part A: Google (Google Cloud Console, about 20 minutes)

**Done 2026-11-11** in Google Cloud project **Huddle** (`huddle-514501`), owned by a separate Google
account rather than Nate's personal one. The consent screen's user support email is the Google Group
`huddle-support@googlegroups.com`, whose member list only its managers can see, so no personal
address is shown to anyone signing in. The app is in **Testing** (only listed test users can sign in
with Google) and has **no logo yet** (adding one starts Google's brand review; do it about a week
before launch, after verifying `huddle.fitness` in Search Console). Client IDs (not secrets):

| Client | ID |
|---|---|
| Huddle web lower | `428334695403-r054kfu523mqkfj3lfatuttcfi7j770i.apps.googleusercontent.com` |
| Huddle web production | `428334695403-brvpo8hso2k60qf4jaqqdfhlg36e67dh.apps.googleusercontent.com` |
| Huddle iOS lower | `428334695403-m6cn7lk9h61hm92ltp6ul014cceoehbs.apps.googleusercontent.com` |
| Huddle iOS production | `428334695403-4rvt9vdifhuoqv681gufes3qses28j20.apps.googleusercontent.com` |


1. **Pick or create a project** for Huddle (one project can hold both environments' clients).
2. **Google Auth Platform → Branding** (the consent screen): app name *Huddle*, support email, the
   Huddle logo, home page `https://huddle.fitness`, privacy policy URL above, terms
   `https://huddle.fitness/terms.html`, authorized domain `huddle.fitness`.
3. **Audience:** *External*. Leave it in *Testing* for now, and add your own Google account(s) as
   test users. Only listed test users can sign in while it says Testing.
4. **Data access (scopes):** only `openid`, `email` and `profile`. These basic scopes don't need
   Google's verification review.
5. **Clients → Create client**, four times:
   - *Web application*, "Huddle web (lower)": Authorized JavaScript origins
     `https://app.dev.huddle.fitness` and `http://localhost:3000`. No redirect URIs (ID-token flow).
   - *Web application*, "Huddle web (production)": origin `https://app.huddle.fitness`.
   - *iOS*, "Huddle iOS (lower)": bundle id `fitness.huddle.app.lower`.
   - *iOS*, "Huddle iOS (production)": bundle id `fitness.huddle.app`.
6. **Copy the four client IDs** (they end in `.apps.googleusercontent.com`). They are **not**
   secrets. The backend needs no client secret at all, because it only verifies ID tokens.
7. **Later, at launch:** Audience → *Publish app* (to "In production"), and brand verification so
   the Huddle name and logo show on the consent screen.

## Part B: Apple (Apple Developer portal, about 30 minutes; it will ask for your 2FA code)

**Done 2026-11-11.** Both App IDs have Sign In with Apple; Services IDs `fitness.huddle.web.lower` and
`fitness.huddle.web`; keys `AQQA8YJY69` (lower) and `38GWY77F9V` (production), stored as the
`APPLE_SIGN_IN_PRIVATE_KEY_LOWER` / `_PROD` GitHub secrets in worktrac-deploy; the
`DoNotReply@huddle.fitness` sender and `huddle.fitness` registered for Hide My Email (SPF passed).


1. **Identifiers → App IDs → `fitness.huddle.app`** → tick *Sign In with Apple* → *Edit*:
   *Enable as a primary App ID*. In the same dialog set the **Server-to-Server Notification
   Endpoint** to `https://api.huddle.fitness/api/webhooks/apple-sign-in`. Save. Repeat for
   `fitness.huddle.app.lower` with `https://api.dev.huddle.fitness/api/webhooks/apple-sign-in`.
   (Changing a capability invalidates the provisioning profiles; the iOS phase regenerates them
   through `match`. Nothing breaks until then.)
2. **Identifiers → + → Services IDs** (one for each web app):
   - `fitness.huddle.web.lower`, description "Huddle web lower" (Apple allows letters, numbers and spaces only): enable *Sign In with Apple* → *Configure*:
     primary App ID `fitness.huddle.app.lower`, domain `app.dev.huddle.fitness`, return URL
     `https://app.dev.huddle.fitness/auth/apple`.
   - `fitness.huddle.web`, description "Huddle web production": primary App ID `fitness.huddle.app`, domain
     `app.huddle.fitness`, return URL `https://app.huddle.fitness/auth/apple`.
   (The web flow uses Apple's popup, but Apple still requires a registered return URL.)
3. 🔑 **Keys → +, one key PER ENVIRONMENT.** A Sign in with Apple key belongs to one primary App
   ID, and Apple refuses it for another app's client id. So: "Huddle Sign in with Apple" →
   *Configure* → primary App ID `fitness.huddle.app`; and "Huddle Sign in with Apple lower" →
   `fitness.huddle.app.lower`. For each, **download the .p8. Apple lets you download it only once.**
   Keep it somewhere safe (a password manager), and note its **Key ID**. Nate does this step;
   Claude does not create, download or read the keys.
4. **Services → Sign in with Apple for Email Communication → Configure:** add the email source
   `DoNotReply@huddle.fitness` (and the domain `huddle.fitness` if it asks). Apple checks the
   domain's SPF. **Without this, every email to a Hide My Email address is silently dropped**:
   invites, resets, welcome emails.

## Part C: Putting it on the servers

The client IDs are not secret and go in `worktrac-deploy`'s backend environment (Claude can open
that PR):

| Variable | Lower | Production |
|---|---|---|
| `SOCIAL_SIGN_IN_ENABLED` | `true` (since 2026-11-11) | `false` until launch |
| `SOCIAL_SIGN_IN_GOOGLE_CLIENT_IDS` | `428334695403-r054kfu523mqkfj3lfatuttcfi7j770i.apps.googleusercontent.com,428334695403-m6cn7lk9h61hm92ltp6ul014cceoehbs.apps.googleusercontent.com` | `428334695403-brvpo8hso2k60qf4jaqqdfhlg36e67dh.apps.googleusercontent.com,428334695403-4rvt9vdifhuoqv681gufes3qses28j20.apps.googleusercontent.com` |
| `SOCIAL_SIGN_IN_APPLE_CLIENT_IDS` | `fitness.huddle.app.lower,fitness.huddle.web.lower` | `fitness.huddle.app,fitness.huddle.web` |
| `APPLE_TEAM_ID` | `R73HV8H48W` | same |
| `APPLE_SIGN_IN_KEY_ID` | `AQQA8YJY69` | `38GWY77F9V` |
| `APPLE_SIGN_IN_PRIVATE_KEY` 🔑 | the lower .p8's text, as a **secret** | the production .p8's text |

The private key is set by Nate with `gh secret set` (Claude can't run secret commands). Claude
provides the exact command, and then makes sure a deploy queued after the change actually runs.

## Part D: The web app's per-environment config (`worktrac-deploy`, Claude's PR)

`config/<env>/frontend-env.json` becomes each web app's `config.json`. A provider shows a button
only when its block is there (`lib/native/socialSignIn.js`):

```json
"socialSignIn": {
  "apple":  { "servicesId": "fitness.huddle.web.lower", "redirectUri": "https://app.dev.huddle.fitness/auth/apple" },
  "google": { "webClientId": "428334695403-r054kfu523mqkfj3lfatuttcfi7j770i.apps.googleusercontent.com" },
  "test": true
}
```

- **`"test": true` on LOWER only.** It lets the e2e suite drive `social-sign-in.spec.ts` there
  (the backend's test provider exists only in local/lower anyway). Never in production.
- Production gets its block at launch, not before. Until then its Login page and Help page are
  unchanged.

## Part E: The iOS app (Claude, once Part B is done)

1. **Sign In with Apple entitlement.** Add `com.apple.developer.applesignin` = `["Default"]` to
   `frontend/ios/App/App/App.entitlements`. **Only after B1** (the capability on both App IDs) and
   the `match` profiles are regenerated, or the next TestFlight build fails to sign.
2. **Google's URL scheme.** Add the REVERSED iOS client id (`com.googleusercontent.apps.<…>`) to
   `Info.plist`'s `CFBundleURLTypes`, per app (lower and production differ, so it is a build
   setting the Fastfile sets, like `APP_LINK_DOMAIN`).
3. **GitHub environment variables** (`mobile-lower`, `mobile-production`; not secrets):
   `NATIVE_GOOGLE_IOS_CLIENT_ID` and `NATIVE_APPLE_SIGN_IN=1`. `mobile-release.yml` already passes
   them to `scripts/write-native-config.mjs`; unset, the app shows no provider buttons.
4. `PrivacyInfo.xcprivacy` + App Store Connect App Privacy: add **User ID** (linked to the user,
   app functionality) for the Apple/Google identity.
5. A lower TestFlight build, then the manual checks on an iPhone and an iPad: sign up, sign in,
   Hide My Email, connect/disconnect, set a password, delete (Apple's revoke).

## Before production turns it on

- [ ] Part A step 7 (Google "In production" + brand verification)
- [ ] `APPLE_SIGN_IN_PRIVATE_KEY` set in production (otherwise deleting an account with Apple
      connected skips Apple's revocation, which App Review checks)
- [ ] The Hide My Email sender registered (B4), and one real invite received at a relay address
- [ ] App Store Connect → App Privacy answers updated (a user ID from Apple/Google)
