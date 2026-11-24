import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHistory } from './useHistory';
import { getHistory } from '../api/sessions';

vi.mock('../api/sessions', () => ({ getHistory: vi.fn() }));

// A device that has never held this person's History, offline: the fetch is paused, nothing is
// held, and isLoading is false -- so readers take the empty list as the answer and memoize over it.
// A fresh [] per render recomputed everything downstream on every render, and ExerciseDetail's
// prefill-recording effect then looped (2026-11-24): hundreds of renders a second, enough to make a
// set logged offline reach disk seconds late, or not before a reload.
describe('useHistory with nothing held', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('hands back the SAME empty list on every render while its fetch is paused', () => {
    onlineManager.setOnline(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result, rerender } = renderHook(() => useHistory(7), { wrapper });
    const first = result.current.history;
    rerender();
    rerender();

    expect(result.current.loading).toBe(false);
    expect(result.current.isPaused).toBe(true);
    expect(first).toEqual([]);
    expect(result.current.history).toBe(first);
    expect(getHistory).not.toHaveBeenCalled();
  });
});
