import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `config` is module-level state cached across calls (see config.js) -- reset the module fresh
// for every test rather than relying on a first-call-wins result leaking between them.
async function freshConfig() {
  vi.resetModules();
  return import('./config');
}

describe('loadConfig', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('resolves with the fetched apiUrl on success', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ apiUrl: 'https://api.example.com' })));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('https://api.example.com/api/foo');
  });

  it('falls back to relative paths when the fetch rejects outright', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { loadConfig, getApiUrl } = await freshConfig();

    await loadConfig();

    expect(getApiUrl('/api/foo')).toBe('/api/foo');
  });

  // The actual regression this closes: main.jsx awaits loadConfig() BEFORE createRoot().render()
  // is ever called, so nothing -- not even AppShellSkeleton -- paints until this settles one way
  // or the other. A hard-offline fetch already rejects fast (covered above); what had no bound at
  // all was a connection to this app's OWN static host that's merely slow rather than actually
  // failing. Left unbounded, that left React with nothing to mount for as long as the hang lasted.
  it('falls back to relative paths rather than hanging forever on a fetch that never settles', async () => {
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
});
