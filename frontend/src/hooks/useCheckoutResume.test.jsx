import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutResume } from './useCheckoutResume';
import { reconcileCheckout } from '../api/billing';
import { readPendingCheckout, rememberPendingCheckout } from '../lib/pendingCheckout';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../api/billing', () => ({ reconcileCheckout: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  navigate.mockReset();
  reconcileCheckout.mockReset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  localStorage.clear();
});

describe('useCheckoutResume', () => {
  it('does nothing when no App Store checkout is pending (always, on the web)', async () => {
    renderHook(() => useCheckoutResume());
    await Promise.resolve();
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });

  it('a paid checkout: clears the marker and hands over to the billing screen\'s own celebration', async () => {
    rememberPendingCheckout('cs_paid');
    reconcileCheckout.mockResolvedValue({ plan: 'PLUS' });

    renderHook(() => useCheckoutResume());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/billing?checkout=cs_paid'));
    expect(readPendingCheckout()).toBeNull();
  });

  // They may only have switched apps mid-checkout. No celebration for an unpaid plan, and the marker
  // stays so the next return can still finish it.
  it('an unpaid checkout: no celebration, and the marker stays for the next return', async () => {
    rememberPendingCheckout('cs_open');
    reconcileCheckout.mockResolvedValue({ plan: 'FREE' });

    renderHook(() => useCheckoutResume());

    await waitFor(() => expect(reconcileCheckout).toHaveBeenCalledWith('cs_open'));
    expect(navigate).not.toHaveBeenCalled();
    expect(readPendingCheckout()).toBe('cs_open');
  });

  it('a session the server refuses (4xx) is forgotten', async () => {
    rememberPendingCheckout('cs_not_ours');
    reconcileCheckout.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    renderHook(() => useCheckoutResume());

    await waitFor(() => expect(readPendingCheckout()).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('no connection (or a struggling server) keeps the marker for the next return', async () => {
    rememberPendingCheckout('cs_later');
    reconcileCheckout.mockRejectedValue(new TypeError('Failed to fetch'));

    renderHook(() => useCheckoutResume());

    await waitFor(() => expect(reconcileCheckout).toHaveBeenCalled());
    expect(readPendingCheckout()).toBe('cs_later');
  });

  it('forgets a checkout older than a day without asking -- a Stripe session lives 24 hours', () => {
    const dayAndAMinuteAgo = Date.now() - (24 * 60 + 1) * 60 * 1000;
    rememberPendingCheckout('cs_stale', dayAndAMinuteAgo);
    expect(readPendingCheckout()).toBeNull();
  });
});
