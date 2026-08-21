import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearClientError, formatClientError, readClientError, recordClientError } from './lastClientError';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('lastClientError', () => {
  it('records and reads back the message, stack and route', () => {
    recordClientError(new Error('boom'), { componentStack: '  at TrendsTab  ' });
    const entry = readClientError();
    expect(entry.message).toBe('boom');
    expect(entry.stack).toBe('at TrendsTab');
    expect(entry.at).toBeTruthy();
  });

  it('keeps only the most recent error', () => {
    recordClientError(new Error('first'), {});
    recordClientError(new Error('second'), {});
    expect(readClientError().message).toBe('second');
  });

  it('clears', () => {
    recordClientError(new Error('boom'), {});
    clearClientError();
    expect(readClientError()).toBeNull();
  });

  it('returns null rather than throwing when the stored value is corrupt', () => {
    localStorage.setItem('worktrac-last-client-error', '{not json');
    expect(readClientError()).toBeNull();
  });

  // The whole module is a diagnostics nicety. It runs inside componentDidCatch, so a throw here
  // would turn a CONTAINED render error into an uncontained one -- the exact opposite of what the
  // error boundary exists to do.
  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => recordClientError(new Error('boom'), {})).not.toThrow();
  });

  it('bounds an enormous stack so it can never be why a submission is rejected', () => {
    recordClientError(new Error('boom'), { componentStack: 'x'.repeat(50000) });
    expect(readClientError().stack.length).toBeLessThanOrEqual(1200);
  });

  it('formats to null when there is nothing recorded', () => {
    expect(formatClientError(null)).toBeNull();
  });
});
