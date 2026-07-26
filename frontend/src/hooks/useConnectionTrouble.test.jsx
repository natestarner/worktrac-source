import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetReachabilityForTests, reachabilityMonitor } from '../lib/reachabilityMonitor';
import { useConnectionTrouble } from './useConnectionTrouble';

function Probe() {
  const trouble = useConnectionTrouble();
  return <span data-testid="state">{trouble ? 'trouble' : 'ok'}</span>;
}

describe('useConnectionTrouble', () => {
  afterEach(() => __resetReachabilityForTests());

  it('reflects the reachability monitor and updates when it flips', () => {
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('ok');

    act(() => {
      reachabilityMonitor.recordFailure();
      reachabilityMonitor.recordFailure();
      reachabilityMonitor.recordFailure();
    });
    expect(screen.getByTestId('state').textContent).toBe('trouble');

    act(() => reachabilityMonitor.recordSuccess());
    expect(screen.getByTestId('state').textContent).toBe('ok');
  });
});
