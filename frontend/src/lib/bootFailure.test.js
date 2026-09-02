import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBootFailure, formatBootFailure, readBootFailure } from './bootFailure';

const KEY = 'worktrac-boot-failure';

const RECORD = {
  v: 1,
  at: '2026-09-02T04:00:00.000Z',
  route: '/app/log',
  waitedMs: 7000,
  painted: false,
  emptiedAfterMs: null,
  readyState: 'complete',
  online: true,
  visibility: 'visible',
  swController: true,
  marks: { bundle: { atMs: 320, detail: null }, config: { atMs: 5100, detail: 'lastKnown' } },
  ua: 'Mozilla/5.0 (iPhone)',
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readBootFailure', () => {
  it('returns nothing when the watchdog never fired', () => {
    expect(readBootFailure()).toBeNull();
  });

  it('reads back what the watchdog wrote', () => {
    localStorage.setItem(KEY, JSON.stringify(RECORD));
    expect(readBootFailure()?.route).toBe('/app/log');
  });

  it('ignores a record from an incompatible earlier shape rather than formatting it wrong', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...RECORD, v: 0 }));
    expect(readBootFailure()).toBeNull();
  });

  // Diagnostics must never be able to break the app they exist to diagnose -- this module is read
  // during a Contact Us render, so a throw here would blank that screen.
  it('degrades to null on a truncated or hand-edited value', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readBootFailure()).toBeNull();
  });

  it('degrades to null when storage itself throws (private mode, disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(readBootFailure()).toBeNull();
  });
});

describe('clearBootFailure', () => {
  it('removes the record', () => {
    localStorage.setItem(KEY, JSON.stringify(RECORD));
    clearBootFailure();
    expect(readBootFailure()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => clearBootFailure()).not.toThrow();
  });
});

describe('formatBootFailure', () => {
  it('leads with whether React ever rendered -- the question triage has to open with', () => {
    const text = formatBootFailure(RECORD);
    expect(text).toContain('never painted');
    expect(text).toContain('React committed nothing');
  });

  it('distinguishes "rendered then went away" from "never rendered"', () => {
    const text = formatBootFailure({ ...RECORD, painted: true, emptiedAfterMs: 4000 });
    expect(text).toContain('painted, then emptied at 4000ms');
    expect(text).not.toContain('never painted');
  });

  // "bundle" absent means the module graph never evaluated -- a failure class no React error
  // boundary can see, and one nothing else in the app records.
  it('says so plainly when the bundle never ran at all', () => {
    expect(formatBootFailure({ ...RECORD, marks: {} })).toContain('the bundle never ran');
  });

  it('reports how far boot got, including which source answered for the config', () => {
    const text = formatBootFailure(RECORD);
    expect(text).toContain('bundle@320ms');
    expect(text).toContain('config@5100ms(lastKnown)');
  });

  it('returns null for no record, so the caller can omit the field entirely', () => {
    expect(formatBootFailure(null)).toBeNull();
  });
});
