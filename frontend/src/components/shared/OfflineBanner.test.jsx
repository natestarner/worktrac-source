import { act, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import OfflineBanner from './OfflineBanner';

// Wrapped in a QueryClientProvider because the banner now reads the durable outbox count. With no
// queued writes, the count is 0, so the online/offline visibility behavior is unchanged.
describe('OfflineBanner', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online with an empty outbox', () => {
    onlineManager.setOnline(true);
    renderWithQuery(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the reassuring offline message while offline', () => {
    onlineManager.setOnline(false);
    renderWithQuery(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('status')).toHaveTextContent(/sync when you reconnect/i);
  });

  it('appears and clears as connectivity flips', () => {
    onlineManager.setOnline(true);
    renderWithQuery(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
