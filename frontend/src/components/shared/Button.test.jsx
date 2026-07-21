import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Button from './Button';

// Button's pending state should always be visible for a minimum stretch, even when the
// wrapped action resolves almost instantly -- otherwise a fast (e.g. already-cached) action
// flashes the spinner for a handful of milliseconds, which reads as "did that even happen"
// almost as much as no feedback at all.
describe('Button minimum pending duration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the spinner visible for at least the floor duration even if the action resolves instantly', async () => {
    const onClick = vi.fn(() => Promise.resolve());
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    await act(async () => {
      fireEvent.click(button);
      // Let the already-resolved promise's microtask actually settle.
      await Promise.resolve();
    });

    expect(button).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(399);
    });
    expect(button).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(button).not.toBeDisabled();
  });

  it('does not hold the button pending any longer than the action itself takes once past the floor', async () => {
    let resolveClick;
    const onClick = vi.fn(() => new Promise((resolve) => { resolveClick = resolve; }));
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    expect(button).toBeDisabled();

    // Well past the floor -- the button should still be waiting on the real action.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(button).toBeDisabled();

    await act(async () => {
      resolveClick();
      await Promise.resolve();
    });
    expect(button).not.toBeDisabled();
  });
});
