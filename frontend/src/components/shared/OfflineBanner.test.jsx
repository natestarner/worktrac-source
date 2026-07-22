import { act, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import OfflineBanner from './OfflineBanner';

describe('OfflineBanner', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online', () => {
    onlineManager.setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the reassuring offline message while offline', () => {
    onlineManager.setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('status')).toHaveTextContent(/sync when you reconnect/i);
  });

  it('appears and clears as connectivity flips', () => {
    onlineManager.setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
