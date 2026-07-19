import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RestTimerBar from './RestTimerBar';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useRestTimerPreference', () => ({ useRestTimerPreference: vi.fn() }));

describe('RestTimerBar', () => {
  it('renders nothing when there is no active timer, regardless of the preference', () => {
    useAppState.mockReturnValue({ activePersonId: 1 });
    useUI.mockReturnValue({ restTimers: {}, addRestTime: vi.fn(), skipRestTimer: vi.fn() });
    useRestTimerPreference.mockReturnValue([true, vi.fn()]);

    const { container } = render(<RestTimerBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the countdown when a timer is active and the preference is enabled', () => {
    useAppState.mockReturnValue({ activePersonId: 1 });
    useUI.mockReturnValue({ restTimers: { 1: { secondsLeft: 45, total: 90 } }, addRestTime: vi.fn(), skipRestTimer: vi.fn() });
    useRestTimerPreference.mockReturnValue([true, vi.fn()]);

    render(<RestTimerBar />);
    expect(screen.getByText('Rest')).toBeInTheDocument();
  });

  it('renders nothing when a timer is active but the preference is disabled', () => {
    useAppState.mockReturnValue({ activePersonId: 1 });
    useUI.mockReturnValue({ restTimers: { 1: { secondsLeft: 45, total: 90 } }, addRestTime: vi.fn(), skipRestTimer: vi.fn() });
    useRestTimerPreference.mockReturnValue([false, vi.fn()]);

    const { container } = render(<RestTimerBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
