import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeReachability } from './reachabilityProbe';

describe('probeReachability', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is true when the health endpoint answers ok', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    expect(await probeReachability()).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toContain('/actuator/health');
  });

  it('is false when the health endpoint answers a non-ok status', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    expect(await probeReachability()).toBe(false);
  });

  it('is false when fetch itself rejects (no response reached at all)', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await probeReachability()).toBe(false);
  });

  it('attaches an AbortController signal so a hung request cannot block forever', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    await probeReachability();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
