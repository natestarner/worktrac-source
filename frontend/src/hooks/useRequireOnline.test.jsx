import { fireEvent, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequireOnline } from './useRequireOnline';
import { useUI } from '../context/UIContext';

vi.mock('../context/UIContext', () => ({ useUI: vi.fn() }));

function Harness({ action }) {
  const { online, requireOnline } = useRequireOnline();
  return (
    <div>
      <span data-testid="online">{String(online)}</span>
      <button onClick={requireOnline(action, 'Needs a connection')}>go</button>
    </div>
  );
}

describe('useRequireOnline', () => {
  let showToast;
  beforeEach(() => {
    showToast = vi.fn();
    useUI.mockReturnValue({ showToast });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('runs the action when online', () => {
    onlineManager.setOnline(true);
    const action = vi.fn();
    render(<Harness action={action} />);
    fireEvent.click(screen.getByText('go'));
    expect(action).toHaveBeenCalledOnce();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('blocks the action and shows a "needs a connection" toast when offline', () => {
    onlineManager.setOnline(false);
    const action = vi.fn();
    render(<Harness action={action} />);
    expect(screen.getByTestId('online').textContent).toBe('false');
    fireEvent.click(screen.getByText('go'));
    expect(action).not.toHaveBeenCalled();
    // Tone matters as much as the message: this is a calm "you can't do that right now",
    // not a failure, and it must not render in the success or the danger colour.
    expect(showToast).toHaveBeenCalledWith('Needs a connection', { tone: 'info' });
  });
});
