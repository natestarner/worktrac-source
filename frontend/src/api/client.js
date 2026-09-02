import { getApiUrl } from '../config';
import { reachabilityMonitor } from '../lib/reachabilityMonitor';
import { getCorrelationId } from '../lib/correlationId';

const TOKEN_STORAGE_KEY = 'workout-tracker-token';

// A request that never gets a response (a dead upstream, captive-portal wifi, a hung TCP
// connection) would otherwise hang indefinitely -- navigator.onLine still reports "online" in
// exactly this case, so nothing else would ever time it out. Bounding it here keeps a stuck
// request from blocking forever and gives reachabilityMonitor a failure to count within a
// reasonable window.
const REQUEST_TIMEOUT_MS = 15000;

// Exports stream a whole history as CSV/ZIP and are legitimately slower than any API call, so they
// get their own, longer bound rather than either sharing the 15s one or (as before) having none.
const EXPORT_TIMEOUT_MS = 60000;

// Import is the same shape of work in the other direction -- a whole history in one request, this
// time thousands of inserts behind it -- so it takes the same bound for the same reason. Bounded is
// the point, not the number; see the divergence row in .claude/rules/resilience.md.
const IMPORT_TIMEOUT_MS = 60000;

// Signing in gets a bound that clears a cold start, because it is the one call with no cached
// answer to fall back on.
//
// Everywhere else, 15s is right precisely BECAUSE something better is waiting behind it: a read
// falls back to the persisted cache, a write goes to the durable outbox, and the boot /me falls
// back to the auth snapshot -- so failing fast gets the person to real content sooner. Credentials
// have none of that. A login that aborts is simply a login that didn't work, and the person's only
// recourse is to type it all again.
//
// Lower runs min-replicas=0 and a measured cold start is ~35s end to end (2026-09-02), during
// which the Container Apps ingress HOLDS the connection rather than refusing it -- so at 15s the
// first sign-in after a scale-to-zero was not merely likely to fail, it was arithmetically certain
// to. 45s clears that with margin while still being bounded, which is the actual requirement.
const AUTH_TIMEOUT_MS = 45000;

let token = localStorage.getItem(TOKEN_STORAGE_KEY) || null;
let onUnauthorized = null;

export function setAuthToken(nextToken) {
  token = nextToken;
  if (nextToken) {
    localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getAuthToken() {
  return token;
}

// AuthContext registers a callback (via useNavigate) so a 401 anywhere can redirect to
// /login without this module needing to be a hook itself.
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Distinguishes "couldn't reach the server" (offline, DNS/connection failure, timeout, or a
// 5xx/gateway error -- incl. lower's scale-to-zero cold-start 503s) from a definitive client-side
// rejection (a 4xx that is the server's real answer). Offline mode treats the former as
// "try again later" -- boot from the cached identity, keep queued writes pending -- while a 4xx is
// a genuine result to surface. A rejected fetch throws a TypeError with no `.status`, which counts
// as unreachable. (The full write-replay taxonomy -- 408/429 as transient etc. -- lands with the
// durable outbox; auth boot only needs the 4xx-vs-rest distinction.)
export function isOfflineError(error) {
  const status = error?.status;
  if (status === undefined || status === null) return true;
  return status >= 500;
}

async function request(path, { method = 'GET', body, isFormData = false, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const hadToken = Boolean(token);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Unconditional -- this is not a connectivity branch and must not become one. The backend puts
  // it in the MDC so every log line a request produces is attributable, which is what makes a
  // Contact Us bug report traceable to what actually happened. See lib/correlationId.js.
  headers['X-Correlation-Id'] = getCorrelationId();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(getApiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    reachabilityMonitor.recordFailure();
    // A timed-out request rejects with the AbortController's own DOMException, whose message is
    // "signal is aborted without reason". Anything that shows a caught error's `.message` to a
    // person -- LoginPage's error banner does, and it is exactly where a cold-start timeout lands
    // -- then renders that string verbatim. Re-throw as an ApiError with no status, which is the
    // shape isOfflineError and shouldRetryWrite already classify as transient, so the failure
    // taxonomy is unchanged and only the wording a human sees is different.
    if (error?.name === 'AbortError') {
      throw new ApiError(undefined, 'Couldn’t reach Huddle. Check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  // Any response at all -- even a 4xx/5xx -- proves this device's network path reached a server,
  // which is exactly the thing navigator.onLine can't confirm (see reachabilityMonitor.js).
  reachabilityMonitor.recordSuccess();

  // A 401 only means "your session expired" if this request actually carried a token --
  // public/unauthenticated endpoints (login, register, confirm-email, resend-code) also
  // return 401 for ordinary "that wasn't right" failures (wrong password, wrong
  // verification code), and there's no session to expire in that case. Redirecting to
  // /login there just discards whatever error the caller was about to show and dumps the
  // user out of a flow they were never logged into to begin with.
  if (response.status === 401 && hadToken) {
    setAuthToken(null);
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, 'Session expired -- please log in again.');
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = (payload && payload.message) || 'Something went wrong';
    throw new ApiError(response.status, message);
  }
  return payload;
}

export const apiClient = {
  get: (path) => request(path),
  // Takes options for the same reason `delete` already does: `request` supports a per-call
  // timeoutMs, and nothing exported could reach it. Import needs the longer bound below.
  post: (path, body, options) => request(path, { method: 'POST', body, ...options }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path, body, options) => request(path, { method: 'DELETE', body, ...options }),
  // Returns the raw Response (CSV/ZIP export), so it can't go through `request` -- that one always
  // parses the body. Everything else about it must still match, and used not to: it had no timeout
  // and never reported to reachabilityMonitor, so an export against a dead backend hung forever
  // and, worse, was invisible to lie-fi detection -- requests that fail here could never
  // contribute to the consecutive-failure count that raises the connection-trouble banner.
  //
  // A longer timeout than REQUEST_TIMEOUT_MS on purpose: a full-history export is legitimately slow
  // in a way an ordinary API call is not, and aborting a working download would be worse than
  // waiting. Bounded is the point, not the exact number.
  getRaw: async (path) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Same header as `request` -- an export that fails is exactly the kind of thing someone writes
    // in about, so it must be correlatable too.
    headers['X-Correlation-Id'] = getCorrelationId();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(getApiUrl(path), { headers, signal: controller.signal });
    } catch (error) {
      reachabilityMonitor.recordFailure();
      // Same mapping as `request` above, for the same reason: an export that times out otherwise
      // surfaces the AbortController's own "signal is aborted without reason" to whoever is
      // reading the failure. Statusless either way, so the failure taxonomy is unchanged.
      if (error?.name === 'AbortError') {
        throw new ApiError(undefined, 'Couldn’t reach Huddle. Check your connection and try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    reachabilityMonitor.recordSuccess();

    if (response.status === 401) {
      setAuthToken(null);
      if (onUnauthorized) onUnauthorized();
      throw new ApiError(401, 'Session expired -- please log in again.');
    }
    if (!response.ok) throw new ApiError(response.status, 'Export failed');
    return response;
  },
};

export { ApiError, IMPORT_TIMEOUT_MS, AUTH_TIMEOUT_MS };
