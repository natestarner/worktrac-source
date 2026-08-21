import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module resolves its id once at import time (like offlineMode.js), so each case needs a fresh
// module registry rather than a re-import of the cached instance.
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('correlationId', () => {
  it('persists the id so it survives a reload', async () => {
    const { getCorrelationId } = await import('./correlationId');
    const first = getCorrelationId();
    expect(first).toBeTruthy();
    expect(localStorage.getItem('worktrac-correlation-id')).toBe(first);

    // A reload = a fresh module evaluation against the same storage.
    vi.resetModules();
    const reloaded = await import('./correlationId');
    expect(reloaded.getCorrelationId()).toBe(first);
  });

  it('reuses an id already in storage rather than minting a new one', async () => {
    localStorage.setItem('worktrac-correlation-id', 'existing-id');
    const { getCorrelationId } = await import('./correlationId');
    expect(getCorrelationId()).toBe('existing-id');
  });

  it('is stable within a session', async () => {
    const { getCorrelationId } = await import('./correlationId');
    expect(getCorrelationId()).toBe(getCorrelationId());
  });

  // Private mode / quota / storage disabled. Correlation within one page session still works; it
  // just doesn't outlive a reload. Diagnostics plumbing must never be able to break the app.
  it('degrades to an in-memory id when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { getCorrelationId } = await import('./correlationId');
    expect(getCorrelationId()).toBeTruthy();
  });

  // The backend sanitizes to [A-Za-z0-9_-] and drops anything else, so an id outside that set
  // would silently produce no correlation at all.
  it('generates an id the backend will accept', async () => {
    const { getCorrelationId } = await import('./correlationId');
    expect(getCorrelationId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
