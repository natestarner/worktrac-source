import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `config` is module-level state cached across calls (see config.js) -- reset the module fresh
// for every test rather than relying on a first-call-wins result leaking between them.
async function freshConfig() {
  vi.resetModules();
  return import('./config');
}

const LAST_KNOWN_API_URL_KEY = 'worktrac-last-known-api-url';

describe('loadConfig', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    localStorage.clear();
  });

  it('resolves with the fetched apiUrl on success', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ apiUrl: 'https://api.example.com' })));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('https://api.example.com/api/foo');
  });

  it('remembers a successfully-fetched apiUrl in localStorage', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ apiUrl: 'https://api.example.com' })));
    const { loadConfig } = await freshConfig();

    await loadConfig();

    expect(localStorage.getItem(LAST_KNOWN_API_URL_KEY)).toBe('https://api.example.com');
  });

  it('falls back to relative paths when the fetch rejects outright and nothing was ever cached', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('/api/foo');
  });

  // The actual regression this closes (found investigating docs/incidents/
  // 2026-08-31-boot-white-screen-recurrence.md's recurrence): a bare `{ apiUrl: '' }` fallback is
  // only safe in local dev, where the Vite proxy makes a relative '/api/...' resolve to the real
  // backend. In every deployed environment there is no such proxy -- confirmed live against lower,
  // a config.json failure sent EVERY subsequent call, including login, to the frontend's own
  // static origin, which answered with a real (non-offline-shaped) 404/405 that none of the app's
  // degraded-conditions machinery ever catches, for the rest of that page's life. The fix: fall
  // back to whatever apiUrl this device last fetched successfully, not to a relative path.
  it('falls back to the LAST KNOWN apiUrl (not a relative path) when the fetch rejects and one was cached', async () => {
    localStorage.setItem(LAST_KNOWN_API_URL_KEY, 'https://worktrac-backend-lower.example.com');
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('https://worktrac-backend-lower.example.com/api/foo');
  });

  it('falls back to the last known apiUrl on a non-2xx response too, not just a rejection', async () => {
    localStorage.setItem(LAST_KNOWN_API_URL_KEY, 'https://worktrac-backend-lower.example.com');
    // A 404/405 from the frontend's own static host still resolves with valid-shaped JSON parsing
    // would accept if response.ok weren't checked -- this response body isn't even JSON, matching
    // what an SWA 404 page actually returns.
    global.fetch.mockResolvedValue(new Response('Not Found', { status: 404 }));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('https://worktrac-backend-lower.example.com/api/foo');
  });

  // The actual regression this closes: main.jsx awaits loadConfig() BEFORE createRoot().render()
  // is ever called, so nothing -- not even AppShellSkeleton -- paints until this settles one way
  // or the other. A hard-offline fetch already rejects fast (covered above); what had no bound at
  // all was a connection to this app's OWN static host that's merely slow rather than actually
  // failing. Left unbounded, that left React with nothing to mount for as long as the hang lasted.
  it('falls back rather than hanging forever on a fetch that never settles', async () => {
    vi.useFakeTimers();
    global.fetch.mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        // Deliberately never resolves or rejects on its own -- only the AbortController's signal
        // (from config.js's own timeout) should ever end this.
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const { loadConfig, getApiUrl } = await freshConfig();

    const pending = loadConfig();
    // CONFIG_FETCH_TIMEOUT_MS in config.js.
    await vi.advanceTimersByTimeAsync(5000);
    await pending;

    expect(getApiUrl('/api/foo')).toBe('/api/foo');
  });

  it('caches the resolved config -- a second call does not fetch again', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ apiUrl: 'https://api.example.com' })));
    const { loadConfig } = await freshConfig();

    await loadConfig();
    await loadConfig();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully when localStorage itself is unavailable', async () => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    try {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      const { loadConfig, getApiUrl } = await freshConfig();

      await expect(loadConfig()).resolves.toBeTruthy();
      expect(getApiUrl('/api/foo')).toBe('/api/foo');
    } finally {
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
