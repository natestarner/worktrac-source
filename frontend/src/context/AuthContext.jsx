import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import {
  confirmEmail as apiConfirmEmail,
  login as apiLogin,
  me as apiMe,
  register as apiRegister,
  requestPasswordReset as apiRequestPasswordReset,
  resendCode as apiResendCode,
  resendResetCode as apiResendResetCode,
  resetPassword as apiResetPassword,
} from '../api/auth';
import { getAuthToken, isOfflineError, setAuthToken, setUnauthorizedHandler } from '../api/client';
import { queryClient, resetQueryCache, clearOutboxMutations, flushOutbox } from '../lib/queryClient';
import { clearOutbox, getOutboxAccountId, restoreOutbox, setOutboxAccountId } from '../lib/outboxPersistence';
import { clearAuthSnapshot, loadAuthSnapshot, saveAuthSnapshot } from '../lib/authSnapshot';
import { requestPersistentStorage } from '../lib/durableStorage';
import { markOnboardingPending } from '../lib/onboardingPending';

const AuthContext = createContext(null);

const EMPTY = { status: 'loading', user: null, account: null, people: [], offline: false, bootStalled: false };
const SIGNED_OUT = { status: 'unauthenticated', user: null, account: null, people: [], offline: false, bootStalled: false };

// Backoff for retrying /me at boot when the server/DB is unreachable and there's no snapshot to
// fall back to (see the boot effect below) -- capped, doubling delay, same shape as the durable
// outbox's own retryDelay (queryClient.js).
export const RECONNECT_RETRY_BASE_MS = 2000;
export const RECONNECT_RETRY_MAX_MS = 30000;

// How many consecutive unreachable-server /me attempts the boot may make before it stops showing
// a bare skeleton and says something. This bounds the VISIBILITY of the wait, not the retry: the
// retry keeps going for as long as the app is open, so a backend that eventually answers still
// heals the screen on its own with no interaction.
//
// It exists because "token present, no snapshot, server unreachable" used to be a terminal state
// with no exit. ProtectedRoute renders AppShellSkeleton for `status === 'loading'`, this branch
// never leaves `loading`, and a reload lands in exactly the same state -- so the person sat on a
// fake loading screen indefinitely and only clearing site data recovered it (measured: 81s and
// still going). That is precisely the "spinner over a request that will never succeed" outcome
// .claude/rules/resilience.md forbids.
//
// Three attempts, not one: a lower cold start is ~35s end to end and api/client.js aborts at 15s,
// so attempts 1-2 failing is the ORDINARY scale-to-zero path, not a fault. Stalling earlier would
// fire on every cold boot; this fires only once the wait is genuinely unexplained.
export const BOOT_STALL_AFTER_ATTEMPTS = 3;

// Records which account currently owns whatever's sitting in the live outbox. If a DIFFERENT
// account is becoming active than the one the outbox pointer says owns it (a shared device: A's
// session expired and B logs in before A returns), evict the in-memory outbox mutations so they
// can never be replayed under B's session/token -- A's own persisted copy (keyed by A's account id,
// see outboxPersistence.js) is untouched and waits for A to log back in. The common case (the SAME
// account re-authenticating after a 401, with no page reload in between) is a no-op here: the
// queued writes never left the mutation cache, so there's nothing to adopt.
//
// Order matters: the pointer is flipped to the NEW account BEFORE evicting the old mutations.
// Evicting fires the outbox's mutation-cache subscription (attachOutboxPersistence), which
// immediately re-persists "now empty" -- if the pointer still said the OLD account at that moment,
// that persist would delete the old account's own still-valid IndexedDB copy. Flipping first makes
// that persist a harmless no-op against the NEW account's (legitimately empty) key instead.
// Returns whether an actual switch happened, so the caller knows whether it's worth also calling
// restoreOutbox for the newly-adopted account's own persisted writes.
function adoptOutboxAccount(accountId) {
  const prior = getOutboxAccountId();
  const switched = Boolean(prior) && accountId != null && String(prior) !== String(accountId);
  setOutboxAccountId(accountId);
  if (switched) clearOutboxMutations();
  return switched;
}

// Turns a freshly-issued token into a verified identity, or leaves the device exactly as it was.
// The single choke point for both credential paths (login and confirmEmail), because both used to
// get this ordering wrong in the same way.
//
// The old order was: resetQueryCache() -> clearAuthSnapshot() -> setAuthToken(token) -> await
// apiMe(). Every teardown ran BEFORE the app had anything to put back, and the token was persisted
// before /me had confirmed a single thing. That is fine right up until /me doesn't answer -- and
// against a scale-to-zero backend it routinely doesn't: lower runs min-replicas=0, a measured cold
// start is ~35s, and api/client.js aborts at 15s, so the first /me after a scale-to-zero reliably
// loses that race even though the credentials were accepted.
//
// What that left on the device was the worst possible combination: a VALID token, NO auth snapshot
// and NO persisted query cache. The boot effect above reads exactly that state as "keep retrying
// /me forever" (it can't tell a stranded token from a live session whose server is briefly down),
// so every later reload sat on the boot skeleton with nothing cached to render and no way out.
// Only clearing site data recovered it. See
// docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md.
//
// So: acquire first, tear down second. Nothing the device is currently relying on is discarded
// until `data` is in hand, and a failed attempt restores the token it found. The window in which
// the app holds a token it hasn't verified is now bounded by this function rather than by whether
// the network cooperates.
async function verifyNewSession(token) {
  const priorToken = getAuthToken();
  setAuthToken(token);
  let data;
  try {
    data = await apiMe();
  } catch (error) {
    // A definitive 4xx means api/client.js has already cleared the token and run the unauthorized
    // handler -- putting it back would resurrect a session the server just rejected. Everything
    // else (abort, timeout, 5xx, cold start) is "couldn't reach the server", which says nothing
    // about this token, so undo our own write and let the caller surface the failure.
    if (isOfflineError(error)) setAuthToken(priorToken);
    throw error;
  }
  // Only now is discarding safe. The QUERY cache still has to go -- account-shared keys (catalog,
  // tags) carry no accountId, so a second household on this device must never read the first's --
  // but a sign-in that never completed must not cost the CURRENT session its offline copy.
  // Deliberately does NOT touch the outbox (see resetQueryCache's own comment); adoptOutboxAccount
  // at each call site handles that, same household or not.
  resetQueryCache();
  clearAuthSnapshot();
  return data;
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetQueryCache();
      clearAuthSnapshot();
      // Deliberately does NOT clear the outbox (hardening #4): a token can expire mid-offline, and a
      // queued write must survive the forced logout so it replays after the user logs back in as the
      // same household -- never silently discarded. Only an explicit user logout clears it (see
      // logout() below). This now actually holds: resetQueryCache() only clears the QUERY cache, not
      // the mutation cache, and the outbox account pointer (outboxPersistence.js) is untouched here
      // too -- previously resetQueryCache's queryClient.clear() silently wiped the outbox anyway.
      setState(SIGNED_OUT);
      navigate('/login');
    });
  }, [navigate]);

  useEffect(() => {
    const tokenAtStart = getAuthToken();
    if (!tokenAtStart) {
      clearAuthSnapshot();
      setState(SIGNED_OUT);
      return undefined;
    }

    let cancelled = false;
    let retryTimer = null;

    // This effect only runs once per app mount ([] deps) -- it is NOT re-run or cancelled by a
    // later logout()/login() the way AppStateContext's hydrate effect is (that one's deps track
    // `status`, so it re-runs and cancels itself). A slow /me from this boot attempt can therefore
    // still be in flight when the user logs out and back in again (confirmed live: a page reload's
    // boot /me was still pending when the subsequent login's own request fired ~200ms later under
    // real network latency). If that stale response is then applied unconditionally, it silently
    // overwrites the newer login's state -- including login()'s `freshLogin` flag, which
    // AppStateContext depends on to reset every person's last-open tab (see the "logging out and
    // back in resets every person's tab" e2e regression this was caught by). Comparing the current
    // token against the one this attempt started with detects exactly that case.
    function isStale() {
      return cancelled || getAuthToken() !== tokenAtStart;
    }

    function attemptMe(nextDelayMs, attempt = 1) {
      apiMe()
        .then((data) => {
          if (isStale()) return;
          // A verified live session -- record the identity so a later cold start with no network
          // can still boot into the app, and mark durable storage so the offline cache isn't
          // evicted.
          saveAuthSnapshot(data);
          adoptOutboxAccount(data.account?.id);
          requestPersistentStorage();
          setState({ status: 'authenticated', offline: false, ...data });
        })
        .catch((error) => {
          if (isStale()) return;
          // Distinguish "session is actually invalid" from "we just couldn't reach the server".
          // A 4xx (esp. 401) is the server's real answer -> sign out. A network/offline/5xx
          // failure with a valid saved token + a last-known identity -> boot the app OFFLINE from
          // the snapshot, so a valid session works with no connectivity instead of bouncing to
          // /login.
          const snapshot = loadAuthSnapshot();
          if (isOfflineError(error) && snapshot) {
            adoptOutboxAccount(snapshot.account?.id);
            requestPersistentStorage();
            setState({ status: 'authenticated', offline: true, ...snapshot });
          } else if (isOfflineError(error)) {
            // Offline-type failure (unreachable server, DB down, timeout) but no snapshot to fall
            // back to -- this token may be perfectly valid; the server just hasn't answered yet
            // (e.g. a brand-new device, or one that's never completed a first successful boot).
            // Signing out here would discard a live session over what's very likely a transient
            // outage. Stay on the loading skeleton (ProtectedRoute treats `loading` the same as
            // the initial boot -- never /login) and keep retrying with backoff instead; a genuine
            // invalid-session 4xx still falls to the branch below on any attempt.
            //
            // Retrying forever is right; showing a bare skeleton forever is not. Once the wait
            // stops being explainable as an ordinary cold start, flag it so ProtectedRoute can
            // offer a way out (see BOOT_STALL_AFTER_ATTEMPTS). The token is deliberately NOT
            // cleared and the retry below is deliberately NOT stopped: this is a change to what
            // the person can SEE and DO, never to what the app is still trying.
            if (attempt >= BOOT_STALL_AFTER_ATTEMPTS) {
              setState((s) => (s.status === 'loading' && !s.bootStalled ? { ...s, bootStalled: true } : s));
            }
            retryTimer = setTimeout(() => {
              if (!isStale()) attemptMe(Math.min(nextDelayMs * 2, RECONNECT_RETRY_MAX_MS), attempt + 1);
            }, nextDelayMs);
          } else {
            // A genuine sign-out (a real 4xx -- the token itself is invalid) must clear the token
            // too, not just the snapshot -- otherwise it rides on the next login POST, and if the
            // backend also rejects THAT (same invalid/stale token), client.js's 401 handler tears
            // the fresh session right back down. Mirrors the unauthorized handler below.
            setAuthToken(null);
            clearAuthSnapshot();
            setState(SIGNED_OUT);
          }
        });
    }

    attemptMe(RECONNECT_RETRY_BASE_MS);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // When connectivity returns after an offline boot, silently reconcile the identity against the
  // server (role/people may have changed) and drop the `offline` flag. A failure here is harmless --
  // we simply stay on the cached identity until the next reconnect.
  useEffect(() => {
    return onlineManager.subscribe((online) => {
      if (!online || !getAuthToken()) return;
      // Same staleness class as the boot effect above: this subscription lives for the whole app
      // session, so its apiMe() call can still be in flight when a logout+login happens meanwhile.
      const tokenAtCall = getAuthToken();
      apiMe()
        .then((data) => {
          if (getAuthToken() !== tokenAtCall) return; // a newer login/logout happened meanwhile
          saveAuthSnapshot(data);
          // Spread the previous state first so an in-flight `freshLogin` flag (see login()/
          // confirmEmail() below) isn't silently clobbered back to falsy if this reconcile happens
          // to fire in the same tick as a fresh login.
          setState((s) => (s.status === 'authenticated' ? { ...s, offline: false, ...data } : s));
        })
        .catch(() => {
          // Still unreachable (server down while network is up) -- keep the cached identity.
        });
    });
  }, []);

  const login = useCallback(async (email, password) => {
    const { token } = await apiLogin({ email, password });
    const data = await verifyNewSession(token);
    saveAuthSnapshot(data);
    const switchedAccount = adoptOutboxAccount(data.account?.id);
    // Only restore when the account actually changed -- the same account's queued writes never left
    // the live mutation cache across a mere 401, and restoring again would duplicate them.
    if (switchedAccount) await restoreOutbox(queryClient);
    flushOutbox();
    requestPersistentStorage();
    // freshLogin distinguishes this explicit, credentials-based sign-in from a silent boot/reconnect
    // reconciliation -- AppStateContext reads it to reset every person's last-open tab back to Log,
    // since resuming wherever the previous user left off is only correct on a mid-session reload.
    setState({ status: 'authenticated', offline: false, freshLogin: true, ...data });
  }, []);

  // Starts the pending registration (sends a verification code) -- no account exists yet, so
  // this does not log the user in. That happens in confirmEmail below, once the code checks
  // out and the account is actually created.
  const register = useCallback(async (payload) => {
    return apiRegister(payload);
  }, []);

  const confirmEmail = useCallback(async ({ email, code }) => {
    const { token } = await apiConfirmEmail({ email, code });
    const data = await verifyNewSession(token);
    saveAuthSnapshot(data);
    // Arms the first-run welcome modal for this account. Here, and NOT in login(): this is the
    // only path where the account is provably created in this same request -- confirmEmail is
    // what turns a pending registration into a real account, so an account reaching this line has
    // just been created, full stop. login() runs on every ordinary sign-in an account will ever
    // do, including years later, so it can never carry that guarantee.
    markOnboardingPending(data.account?.id);
    // A brand-new account has no queued writes of its own, but a PREVIOUS household's outbox may
    // still be sitting in memory on this shared device -- same protection as login() above.
    const switchedAccount = adoptOutboxAccount(data.account?.id);
    if (switchedAccount) await restoreOutbox(queryClient);
    flushOutbox();
    requestPersistentStorage();
    // See login()'s comment on freshLogin -- a brand-new confirmed registration is equally a "start
    // fresh on Log" moment, not a resume.
    setState({ status: 'authenticated', offline: false, freshLogin: true, ...data });
  }, []);

  const resendCode = useCallback(async ({ email }) => {
    return apiResendCode({ email });
  }, []);

  // Does not log the user in -- reset requires re-entering the new password at /login
  // afterward, same as any other password change.
  const requestPasswordReset = useCallback(async ({ email }) => {
    return apiRequestPasswordReset({ email });
  }, []);

  const resetPassword = useCallback(async ({ email, code, password }) => {
    return apiResetPassword({ email, code, password });
  }, []);

  const resendResetCode = useCallback(async ({ email }) => {
    return apiResendResetCode({ email });
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    resetQueryCache();
    clearAuthSnapshot();
    // Explicit logout DISCARDS queued writes (a different household may log in next). UserMenu warns
    // first when the outbox is non-empty, so this is a confirmed choice, not silent data loss. Both
    // the in-memory mutations and their persisted IndexedDB copy must be cleared explicitly --
    // resetQueryCache() no longer does this as a side effect (see its own comment).
    clearOutboxMutations();
    clearOutbox();
    setState(SIGNED_OUT);
  }, []);

  // /api/auth/me returns account+people together; used both after adding/removing a
  // person and after changing the account's default unit in Admin. Keep the offline-boot snapshot
  // in step so a later cold start reflects the latest people/account too.
  const refreshPeople = useCallback(async () => {
    const data = await apiMe();
    saveAuthSnapshot(data);
    setState((s) => ({ ...s, account: data.account, people: data.people }));
  }, []);

  const isAdmin = state.user?.role === 'ADMIN';

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAdmin,
        login,
        register,
        confirmEmail,
        resendCode,
        requestPasswordReset,
        resetPassword,
        resendResetCode,
        logout,
        refreshPeople,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
