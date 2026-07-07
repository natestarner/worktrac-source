import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, getAuthToken, setAuthToken, setUnauthorizedHandler } from './client';

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

  it('clears the token and invokes the unauthorized handler on a 401', async () => {
    setAuthToken('expired-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    global.fetch.mockReturnValue(Promise.resolve(new Response(null, { status: 401 })));

    await expect(apiClient.get('/api/people')).rejects.toThrow();

    expect(getAuthToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('throws with the server message on a non-2xx response', async () => {
    global.fetch.mockReturnValue(jsonResponse({ message: 'Cannot delete the primary person on an account' }, 409));

    await expect(apiClient.delete('/api/people/1')).rejects.toThrow('Cannot delete the primary person on an account');
  });
});
