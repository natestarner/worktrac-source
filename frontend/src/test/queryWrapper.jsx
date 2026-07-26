import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { registerOfflineMutationDefaults } from '../lib/queryClient';

// A fresh QueryClient per render keeps tests isolated (no cache bleed between cases) and turns off
// retries so a mocked rejection surfaces immediately instead of being retried on a timer.
export function renderWithQuery(ui, options) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Give the test client the same durable-write defaults the app registers (so log-set has its
  // mutationFn/scope/reconciliation), but with retries off so a mocked rejection fails fast.
  registerOfflineMutationDefaults(queryClient, { retry: false });
  // Expose the client alongside RTL's usual render result so a test can inspect the cache
  // directly (e.g. an optimistically-seeded liveSession entry) without needing its own provider.
  return { ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options), queryClient };
}
