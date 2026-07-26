import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
