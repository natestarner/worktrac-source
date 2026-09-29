import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_FIRST_PAGE, HISTORY_PAGE, useGrowingList } from './useGrowingList';

describe('useGrowingList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts at the first page and never past the list', () => {
    expect(renderHook(() => useGrowingList(1000)).result.current).toMatchObject({ shown: HISTORY_FIRST_PAGE, more: true });
    expect(renderHook(() => useGrowingList(12)).result.current).toMatchObject({ shown: 12, more: false });
  });

  // A jump to a workout not drawn yet ("View this exercise's history" after a filter reorders
  // nothing, but a deep link can name any workout): drawn through it, with a page below to land on.
  it('draws through a workout a jump names, and a page past it', () => {
    const { result } = renderHook(() => useGrowingList(1000));
    act(() => result.current.showThrough(500));
    expect(result.current.shown).toBe(500 + 1 + HISTORY_PAGE);
    act(() => result.current.showThrough(3)); // never shrinks
    expect(result.current.shown).toBe(500 + 1 + HISTORY_PAGE);
  });
});
