import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

// A fresh QueryClient per render keeps tests isolated (no cache bleed between cases) and turns off
// retries so a mocked rejection surfaces immediately instead of being retried on a timer.
export function renderWithQuery(ui, options) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options);
}
