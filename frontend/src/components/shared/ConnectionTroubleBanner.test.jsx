import { act, fireEvent, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetOfflineModeForTests, isOfflinePinned } from '../../lib/offlineMode';
import { __resetReachabilityForTests, reachabilityMonitor } from '../../lib/reachabilityMonitor';
import ConnectionTroubleBanner from './ConnectionTroubleBanner';

function markTrouble() {
  reachabilityMonitor.recordFailure();
  reachabilityMonitor.recordFailure();
  reachabilityMonitor.recordFailure();
}

describe('ConnectionTroubleBanner', () => {
  afterEach(() => {
    __resetOfflineModeForTests();
    __resetReachabilityForTests();
    onlineManager.setOnline(true);
  });

  it('renders nothing when there is no trouble', () => {
    onlineManager.setOnline(true);
    render(<ConnectionTroubleBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows once several consecutive requests fail while still reporting online', () => {
    onlineManager.setOnline(true);
    render(<ConnectionTroubleBanner />);

    act(() => markTrouble());

    expect(screen.getByRole('status')).toHaveTextContent(/having trouble connecting/i);
    expect(screen.getByRole('button', { name: 'Go offline' })).toBeInTheDocument();
  });

  it('stays hidden while genuinely hard-offline (not the lie-fi case it targets)', () => {
    onlineManager.setOnline(false);
    render(<ConnectionTroubleBanner />);

    act(() => markTrouble());

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clicking "Go offline" pins the app and hides the banner', () => {
    onlineManager.setOnline(true);
    render(<ConnectionTroubleBanner />);
    act(() => markTrouble());

    fireEvent.click(screen.getByRole('button', { name: 'Go offline' }));

    expect(isOfflinePinned()).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
