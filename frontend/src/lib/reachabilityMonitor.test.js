import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetReachabilityForTests, reachabilityMonitor } from './reachabilityMonitor';

describe('reachabilityMonitor', () => {
  afterEach(() => __resetReachabilityForTests());

  it('stays false after fewer than the consecutive-failure threshold', () => {
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    expect(reachabilityMonitor.isTrouble()).toBe(false);
  });

  it('flips to true after enough consecutive failures', () => {
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    expect(reachabilityMonitor.isTrouble()).toBe(true);
  });

  it('a success resets the failure count, so trouble does not fire on the next blip alone', () => {
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordSuccess();
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    expect(reachabilityMonitor.isTrouble()).toBe(false);
  });

  it('a success after trouble has fired clears it', () => {
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    expect(reachabilityMonitor.isTrouble()).toBe(true);

    reachabilityMonitor.recordSuccess();
    expect(reachabilityMonitor.isTrouble()).toBe(false);
  });

  it('notifies subscribers only when the trouble state actually changes', () => {
    const listener = vi.fn();
    const unsubscribe = reachabilityMonitor.subscribe(listener);

    reachabilityMonitor.recordFailure();
    reachabilityMonitor.recordFailure();
    expect(listener).not.toHaveBeenCalled();

    reachabilityMonitor.recordFailure();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);

    reachabilityMonitor.recordFailure();
    expect(listener).toHaveBeenCalledOnce();

    reachabilityMonitor.recordSuccess();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);

    unsubscribe();
  });
});
