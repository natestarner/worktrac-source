import { afterEach, describe, expect, it, vi } from 'vitest';

// requestPersistentStorage has a module-level once-guard, so reset the module between tests to get a
// fresh instance each time.
async function freshModule() {
  vi.resetModules();
  return (await import('./durableStorage')).requestPersistentStorage;
}

describe('requestPersistentStorage', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });
    vi.restoreAllMocks();
  });

  function stubStorage(storage) {
    Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
  }

  it('requests persistence and returns the granted result', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) });
    const requestPersistentStorage = await freshModule();

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('short-circuits when storage is already persisted', async () => {
    const persist = vi.fn();
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(true) });
    const requestPersistentStorage = await freshModule();

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('only requests once even if called repeatedly', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) });
    const requestPersistentStorage = await freshModule();

    await requestPersistentStorage();
    await requestPersistentStorage();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('resolves false (never throws) when the API is unavailable', async () => {
    stubStorage(undefined);
    const requestPersistentStorage = await freshModule();
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('swallows an error from persist()', async () => {
    stubStorage({ persist: vi.fn().mockRejectedValue(new Error('denied')), persisted: vi.fn().mockResolvedValue(false) });
    const requestPersistentStorage = await freshModule();
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
