import { act, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { useOnlineStatus } from './useOnlineStatus';

function Probe() {
  const online = useOnlineStatus();
  return <span data-testid="state">{online ? 'online' : 'offline'}</span>;
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    // Leave the shared onlineManager in a definite online state so no later test inherits "offline".
    onlineManager.setOnline(true);
  });

  it('reflects the current online state and updates when it flips', () => {
    onlineManager.setOnline(true);
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('online');

    act(() => onlineManager.setOnline(false));
    expect(screen.getByTestId('state').textContent).toBe('offline');

    act(() => onlineManager.setOnline(true));
    expect(screen.getByTestId('state').textContent).toBe('online');
  });
});
