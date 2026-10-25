import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutCompletePage from './CheckoutCompletePage';
import { appReturnUrl } from '../lib/native';

// jsdom's host is localhost, which no app claims, so the host -> scheme mapping itself is pinned in
// appLinks.test.js; this file pins what the page does with its answer.
vi.mock('../lib/native', () => ({ appReturnUrl: vi.fn() }));

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CheckoutCompletePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  appReturnUrl.mockReset();
});

describe('CheckoutCompletePage', () => {
  // Stripe's redirect leaves the person in Safari; this button is their one-tap way back.
  it('offers the way back into the app after paying, carrying the session through', () => {
    appReturnUrl.mockImplementation((host, search) => `fitness.huddle.app.lower://checkout-complete${search}`);
    renderAt('/checkout-complete?session_id=cs_1');

    expect(appReturnUrl).toHaveBeenCalledWith(window.location.hostname, '?session_id=cs_1');
    expect(screen.getByRole('link', { name: 'Return to the Huddle app' })).toHaveAttribute(
      'href',
      'fitness.huddle.app.lower://checkout-complete?session_id=cs_1',
    );
    expect(screen.getByRole('link', { name: 'Open Huddle in this browser instead' })).toBeInTheDocument();
  });

  it('offers it after a cancelled checkout too', () => {
    appReturnUrl.mockReturnValue('fitness.huddle.app://checkout-complete?cancelled=1');
    renderAt('/checkout-complete?cancelled=1');

    expect(screen.getByRole('heading', { name: 'Checkout cancelled' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to the Huddle app' })).toBeInTheDocument();
  });

  it('shows no return button on a host no app claims', () => {
    appReturnUrl.mockReturnValue(null);
    renderAt('/checkout-complete?session_id=cs_1');

    expect(screen.queryByRole('link', { name: 'Return to the Huddle app' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Payment complete' })).toBeInTheDocument();
  });
});
