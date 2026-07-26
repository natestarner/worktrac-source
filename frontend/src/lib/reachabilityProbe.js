import { getApiUrl } from '../config';

const PING_TIMEOUT_MS = 5000;

// A one-shot "is the server actually reachable right now?" check, deliberately outside api/client.js
// so it never feeds reachabilityMonitor's separate "trouble" signal (that one detects the opposite
// direction -- claims online, but failing) and never triggers a 401/session-expiry side effect. Used
// both by the passive recovery heartbeat (polls on a backoff while pinned offline) and by the
// offline banner's "Go back online" button (a single check on demand, before leaving offline mode).
export async function probeReachability() {
  const controller = new AbortController();
  const abortId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(getApiUrl('/actuator/health'), { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(abortId);
  }
}
