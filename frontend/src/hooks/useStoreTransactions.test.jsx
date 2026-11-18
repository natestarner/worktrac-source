import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoreTransactions } from './useStoreTransactions';
import { onPurchaseIntent, onTransaction, unfinishedTransactions } from '../lib/native';
import { syncAndFinish } from '../lib/storeSync';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ refreshPeople: vi.fn().mockResolvedValue() }) }));
vi.mock('./useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../lib/storeSync', () => ({ syncAndFinish: vi.fn() }));
vi.mock('../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  storeSource: () => 'app-store',
  onPurchaseIntent: vi.fn(() => () => {}),
  onTransaction: vi.fn(() => () => {}),
  unfinishedTransactions: vi.fn(),
}));

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useStoreTransactions(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('useStoreTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unfinishedTransactions.mockResolvedValue([]);
    syncAndFinish.mockResolvedValue(null);
  });

  // Apple's PurchaseIntent: "subscribe" on the App Store page is completed in the app, by Billing.
  it('takes a purchase started on the App Store page to Billing with the chosen product', () => {
    render();
    const deliver = onPurchaseIntent.mock.calls[0][0];
    deliver({ productId: 'huddle.plus.year' });
    expect(navigate).toHaveBeenCalledWith('/app/billing?buy=huddle.plus.year');
  });

  it('subscribes to purchase intents once, however often it re-renders', () => {
    const view = render();
    view.rerender();
    view.rerender();
    expect(onPurchaseIntent).toHaveBeenCalledTimes(1);
  });

  // The store's unfinished queue is the retry: swept on mount, sent, finished only on a 2xx.
  it('sends unfinished transactions on mount, and a transaction the store reports', async () => {
    const proof = { proof: 'jws', transactionId: '1' };
    unfinishedTransactions.mockResolvedValue([proof]);
    render();
    await waitFor(() => expect(syncAndFinish).toHaveBeenCalledWith([proof]));

    const deliver = onTransaction.mock.calls[0][0];
    deliver({ proof: 'jws-2', transactionId: '2' });
    expect(syncAndFinish).toHaveBeenCalledWith([{ proof: 'jws-2', transactionId: '2' }]);
  });
});
