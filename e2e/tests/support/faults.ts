import { Page, Route } from '@playwright/test';

// Anchored to the path starting with /api/ right after the origin -- NOT a bare '**/api/**' glob.
// In local dev only, Vite serves ES modules unbundled straight from source (e.g.
// http://localhost:3000/src/api/queryKeys.js), which also contains "/api/" as a path segment; a
// reload while that broader pattern is active blocks the app's own JS modules, not just backend
// calls, and the page never renders at all. Only reload-based fault tests need this --
// production/lower serves bundled, hashed assets with no such collision.
export const API_ONLY = /^https?:\/\/[^/]+\/api\//;

// Aborts matching requests to simulate a dead connection -- a rejected fetch with no `.status`,
// which is exactly what api/client.js's isOfflineError/retry logic and reachabilityMonitor both
// treat as "the network path failed", NOT a server answer. This is the only fault type that can
// drive ConnectionTroubleBanner (see reachabilityMonitor.js): a fulfilled response, even a 5xx,
// still counts as reachable (see failWithStatus below), so a "lie-fi" test must use this, not that.
//
// `times: Infinity` (the default) blocks indefinitely -- call `.stop()` on the returned handle (or
// `.resume()` to re-arm it) to control the failure window from the test.
//
// `count()` reports how many requests have actually been intercepted-and-failed so far. This is
// what lets a test wait on "the retry loop has genuinely made N attempts" (a real, observable
// signal) instead of guessing how long that many retries might take with a fixed sleep.
export async function failNetwork(page: Page, urlPattern: string | RegExp, times = Infinity) {
  let count = 0;
  let failing = true;
  await page.route(urlPattern, async (route: Route) => {
    if (failing && count < times) {
      count += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return {
    stop: () => {
      failing = false;
    },
    resume: () => {
      failing = true;
    },
    count: () => count,
  };
}

// Fulfills matching requests with a real HTTP error status `times` times, then passes real
// requests through. A completed response (even non-2xx) reaches api/client.js's
// `reachabilityMonitor.recordSuccess()` line, so this does NOT trip the connection-trouble
// signal -- it simulates a transient 5xx a retry can recover from (or a definitive 4xx that
// should fail fast), not a dead connection.
export async function failWithStatus(page: Page, urlPattern: string | RegExp, status: number, times = 1) {
  let count = 0;
  await page.route(urlPattern, async (route: Route) => {
    count += 1;
    if (count <= times) {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Simulated failure' }),
      });
      return;
    }
    await route.continue();
  });
}

// Holds matching requests open for `delayMs` and then lets them through for real -- axis A's
// "slow but alive" row, which neither failNetwork (a rejected fetch) nor failWithStatus (an
// immediate error response) can produce. A merely-slow backend is indistinguishable from a dead one
// to the client until api/client.js's REQUEST_TIMEOUT_MS fires, and the interesting window is
// BEFORE that: the write is genuinely in flight, the outbox still holds it, and any reload lands
// mid-write. That is the one condition a cold-starting lower backend produces routinely.
//
// `.stop()` lets the remaining requests through untouched, so a test can end the slow period
// without waiting out an in-flight delay.
export async function delayNetwork(page: Page, urlPattern: string | RegExp, delayMs: number) {
  let delaying = true;
  await page.route(urlPattern, async (route: Route) => {
    if (delaying) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  return {
    stop: () => {
      delaying = false;
    },
  };
}

export async function clearFaults(page: Page, urlPattern: string | RegExp) {
  await page.unroute(urlPattern);
}
