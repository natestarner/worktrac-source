import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetOfflineModeForTests, pinOffline, unpinOffline } from '../lib/offlineMode';
import { useOfflinePin } from './useOfflinePin';

function Probe() {
  const pinned = useOfflinePin();
  return <span data-testid="state">{pinned ? 'pinned' : 'not-pinned'}</span>;
}

describe('useOfflinePin', () => {
  afterEach(() => __resetOfflineModeForTests());

  it('reflects the current pin state and updates when it flips', () => {
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('not-pinned');

    act(() => pinOffline());
    expect(screen.getByTestId('state').textContent).toBe('pinned');

    act(() => unpinOffline());
    expect(screen.getByTestId('state').textContent).toBe('not-pinned');
  });
});
