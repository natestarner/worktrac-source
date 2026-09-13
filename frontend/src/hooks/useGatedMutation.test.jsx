import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useGatedMutation } from './useGatedMutation';

const showToast = vi.fn();
vi.mock('../context/UIContext', () => ({ useUI: () => ({ showToast }) }));

// requireOnline's own offline behaviour is covered by useRequireOnline's tests; here it is a
// pass-through so every case below is about what happens AFTER the request was actually made.
vi.mock('./useRequireOnline', () => ({
  useRequireOnline: () => ({
    online: true,
    requireOnline: (fn) => fn,
  }),
}));

// The real predicate, not a stub -- what counts as "the server gave a considered answer" is the
// whole distinction being tested, and a stub would let it drift from api/client.js.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

function failWith(error) {
  return async () => {
    throw error;
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

describe('useGatedMutation error copy', () => {
  beforeEach(() => {
    showToast.mockClear();
  });

  it('shows the call site’s own message by default', async () => {
    const { result } = renderHook(() => useGatedMutation());
    const run = result.current.run(failWith(httpError(409, 'Ask Nate to rename it.')), {
      errorMessage: "Couldn't save — check your connection and try again.",
    });

    await act(async () => {
      await run();
    });

    // No opt-in, so the server's sentence is deliberately NOT used -- backend 4xx text is not
    // uniformly written for a person, and ~35 Tier-3 writes rely on this default.
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't save — check your connection and try again.",
      { tone: 'error' },
    );
  });

  /**
   * ⚠️ THE ONE THAT MATTERS. A rename refused because other people already use the exercise is the
   * server explaining something specific and actionable, naming who to ask. Replacing that with
   * "check your connection" is worse than saying nothing: it sends someone hunting for signal over
   * something no connection will ever fix -- the same failure mode ReadOnlyWrap prevents a layer up.
   */
  it('shows the server’s own explanation for a definitive 4xx when asked to', async () => {
    const { result } = renderHook(() => useGatedMutation());
    const run = result.current.run(
      failWith(httpError(409, 'Other people have already used this exercise. Ask Nate to rename it.')),
      {
        errorMessage: "Couldn't save — check your connection and try again.",
        showServerMessage: true,
      },
    );

    await act(async () => {
      await run();
    });

    expect(showToast).toHaveBeenCalledWith(
      'Other people have already used this exercise. Ask Nate to rename it.',
      { tone: 'error' },
    );
  });

  // A 5xx is isOfflineError by design -- the server did not deliver a considered answer, so its
  // text (a stack-trace-ish 500 body) is worth less than our calm sentence. Opting in must not
  // change that.
  it('keeps the call site’s message for a 5xx even when opted in', async () => {
    const { result } = renderHook(() => useGatedMutation());
    const run = result.current.run(failWith(httpError(503, 'Service Unavailable')), {
      errorMessage: "Couldn't save — check your connection and try again.",
      showServerMessage: true,
    });

    await act(async () => {
      await run();
    });

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't save — check your connection and try again.",
      { tone: 'error' },
    );
  });

  // A dropped connection has no status at all. Same reasoning: nothing considered to report.
  it('keeps the call site’s message when the connection simply failed', async () => {
    const { result } = renderHook(() => useGatedMutation());
    const run = result.current.run(failWith(new Error('Failed to fetch')), {
      errorMessage: "Couldn't save — check your connection and try again.",
      showServerMessage: true,
    });

    await act(async () => {
      await run();
    });

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't save — check your connection and try again.",
      { tone: 'error' },
    );
  });
});
