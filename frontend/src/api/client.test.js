import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCorrelationId } from '../lib/correlationId';
import { apiClient, getAuthToken, isOfflineError, setAuthToken, setUnauthorizedHandler } from './client';
import { __resetReachabilityForTests, reachabilityMonitor } from '../lib/reachabilityMonitor';

function jsonResponse(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('apiClient', () => {
  beforeEach(() => {
    setAuthToken(null);
    setUnauthorizedHandler(null);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches the bearer token when one is set', async () => {
    setAuthToken('abc123');
    global.fetch.mockReturnValue(jsonResponse({ ok: true }));

    await apiClient.get('/api/whoami');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer abc123');
  });

  it('omits the Authorization header when no token is set', async () => {
    global.fetch.mockReturnValue(jsonResponse({ ok: true }));

    await apiClient.get('/api/public');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  // Unconditional, and on EVERY request -- an unauthenticated one included. It is what lets a
  // Contact Us submission be traced to the person's actual request trail in Log Analytics rather
  // than correlated by timestamp alone. See lib/correlationId.js and RequestDiagnosticsFilter.
  it('attaches the correlation id to every request, authenticated or not', async () => {
    global.fetch.mockReturnValue(jsonResponse({ ok: true }));

    await apiClient.get('/api/public');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Correlation-Id']).toBe(getCorrelationId());
    // The backend drops anything outside this set, so an id it would reject means no correlation.
    expect(options.headers['X-Correlation-Id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('sends the same correlation id on the next request', async () => {
    // A fresh Response per call -- a single mocked object can only have its body read once.
    global.fetch.mockImplementation(() => jsonResponse({ ok: true }));

    await apiClient.get('/api/one');
    await apiClient.get('/api/two');

    const first = global.fetch.mock.calls[0][1].headers['X-Correlation-Id'];
    const second = global.fetch.mock.calls[1][1].headers['X-Correlation-Id'];
    expect(second).toBe(first);
  });

  it('clears the token and invokes the unauthorized handler on a 401 for an authenticated request', async () => {
    setAuthToken('expired-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    global.fetch.mockReturnValue(Promise.resolve(new Response(null, { status: 401 })));

    await expect(apiClient.get('/api/people')).rejects.toThrow();

    expect(getAuthToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('surfaces the server message on a 401 from an unauthenticated request without redirecting', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    global.fetch.mockReturnValue(jsonResponse({ message: 'Incorrect code' }, 401));

    await expect(apiClient.post('/api/auth/confirm-email', { email: 'a@b.com', code: '000000' })).rejects.toThrow(
      'Incorrect code',
    );

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('throws with the server message on a non-2xx response', async () => {
    global.fetch.mockReturnValue(jsonResponse({ message: 'Cannot delete the primary person on an account' }, 409));

    await expect(apiClient.delete('/api/people/1')).rejects.toThrow('Cannot delete the primary person on an account');
  });
});

describe('apiClient reachability reporting', () => {
  beforeEach(() => {
    setAuthToken(null);
    setUnauthorizedHandler(null);
    global.fetch = vi.fn();
    __resetReachabilityForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetReachabilityForTests();
  });

  it('records a success on any completed response, even a non-2xx one', async () => {
    global.fetch.mockReturnValue(jsonResponse({ message: 'not found' }, 404));

    await expect(apiClient.get('/api/whatever')).rejects.toThrow();

    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    // A 4xx is the server's real answer -- it must have already reset the failure count to 0,
    // so two more failures alone aren't enough to cross the trouble threshold.
    expect(reachabilityMonitor.isTrouble()).toBe(false);
  });

  it('records a failure when fetch itself rejects (no response reached at all)', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiClient.get('/api/whatever')).rejects.toThrow();
    await expect(apiClient.get('/api/whatever')).rejects.toThrow();
    await expect(apiClient.get('/api/whatever')).rejects.toThrow();

    expect(reachabilityMonitor.isTrouble()).toBe(true);
  });

  it('attaches an AbortController signal so a hung request can be bounded by a timeout', async () => {
    global.fetch.mockReturnValue(jsonResponse({ ok: true }));

    await apiClient.get('/api/whoami');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  // Regression test for the delete-test-data timeout bug: the shared 15s default fired before
  // the (then one-account-at-a-time) backend delete finished, and the client timing out never
  // canceled the still-running backend transaction. deleteTestData() now passes a longer
  // timeoutMs specifically for this call (see admin.js) -- this proves apiClient.delete's new
  // options parameter actually reaches the AbortController, not just that it's accepted and
  // ignored.
  it('honors a per-call timeoutMs option instead of the shared default', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    let settled = false;
    apiClient
      .delete('/api/admin/test-data', undefined, { timeoutMs: 60000 })
      .catch(() => {})
      .finally(() => {
        settled = true;
      });

    // Well past the shared 15s default, but still under the custom 60s -- must NOT have aborted.
    await vi.advanceTimersByTimeAsync(20000);
    expect(settled).toBe(false);

    // Now cross the custom 60s timeout and confirm it eventually does.
    await vi.advanceTimersByTimeAsync(45000);
    expect(settled).toBe(true);

    vi.useRealTimers();
  });

  // A timed-out request rejects with the AbortController's own DOMException, whose message is
  // the string "signal is aborted without reason" -- and LoginPage renders a caught error's
  // `.message` straight into its error banner, which is exactly where a cold-start timeout lands.
  // That is what a person saw after a failed sign-in against a scale-to-zero backend on
  // 2026-09-02. The classification must not change with the wording: no status still means
  // "unreachable" to isOfflineError and "retry" to shouldRetryWrite.
  it('turns a timeout into a human message while keeping it statusless (i.e. still transient)', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')));
        }),
    );

    let caught;
    apiClient.get('/api/auth/me').catch((e) => {
      caught = e;
    });
    await vi.advanceTimersByTimeAsync(20000);

    expect(caught).toBeDefined();
    expect(caught.message).not.toMatch(/signal is aborted/i);
    expect(caught.message).toMatch(/couldn’t reach huddle/i);
    expect(caught.status).toBeUndefined();
    expect(isOfflineError(caught)).toBe(true);

    vi.useRealTimers();
  });
});

describe('isOfflineError', () => {
  it('treats a fetch reject (no status) as offline/unreachable', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError({})).toBe(true);
  });

  it('treats 5xx / gateway errors (server, DB, ingress down incl. cold-start 503) as offline', () => {
    expect(isOfflineError({ status: 500 })).toBe(true);
    expect(isOfflineError({ status: 502 })).toBe(true);
    expect(isOfflineError({ status: 503 })).toBe(true);
    expect(isOfflineError({ status: 504 })).toBe(true);
  });

  it('treats a 4xx (the server\'s real answer) as NOT offline', () => {
    expect(isOfflineError({ status: 400 })).toBe(false);
    expect(isOfflineError({ status: 401 })).toBe(false);
    expect(isOfflineError({ status: 404 })).toBe(false);
    expect(isOfflineError({ status: 409 })).toBe(false);
  });
});
