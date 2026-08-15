import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DurationPickerSheet from './DurationPickerSheet';

// The sheet's whole job beyond hosting the wheel is deciding WHEN an edit counts. Everything here
// is about that boundary: the wheel moves freely, and only Done writes through.

describe('DurationPickerSheet', () => {
  let onChange;
  let onClose;

  function open(valueSeconds = 90) {
    onChange = vi.fn();
    onClose = vi.fn();
    render(<DurationPickerSheet valueSeconds={valueSeconds} onChange={onChange} onClose={onClose} />);
  }

  function secondsCol() {
    return screen.getByRole('listbox', { name: 'Seconds' });
  }
  function selectedSeconds() {
    return within(secondsCol()).getByRole('option', { selected: true }).textContent;
  }

  beforeEach(() => vi.clearAllMocks());

  it('opens on the current value', () => {
    open(135);
    expect(within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { selected: true })).toHaveTextContent('2');
    expect(selectedSeconds()).toBe('15');
  });

  it('writes the picked value through on Done', () => {
    open(90);

    fireEvent.keyDown(secondsCol(), { key: '4' });
    fireEvent.keyDown(secondsCol(), { key: '5' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenCalledWith(105);
    expect(onClose).toHaveBeenCalled();
  });

  // Turning the wheel is not a decision. If closing kept the value, a stray Escape would silently
  // OVERWRITE a time rather than silently discard one -- the same class of accident the "a modal
  // never closes on a backdrop tap" rule exists to prevent, pointed the other way.
  it('discards the edit on Cancel', () => {
    open(90);

    fireEvent.keyDown(secondsCol(), { key: '4' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('discards the edit on the header X', () => {
    open(90);

    fireEvent.keyDown(secondsCol(), { key: '4' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('discards the edit on Escape', () => {
    open(90);

    fireEvent.keyDown(secondsCol(), { key: '4' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Clear empties the wheel without closing or committing on its own', () => {
    open(135);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(selectedSeconds()).toBe('0');
    expect(within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { selected: true })).toHaveTextContent('0');
    expect(onClose).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  // The point of Clear is that you can then COMMIT the clear. 0:00 is not a duration the backend
  // will take (@Min(1)), so it commits as null -- the "no value chosen" state Weight and Reps
  // already render as an em dash. Done must stay enabled: disabling it makes Clear a dead end,
  // with no way to write the thing the button just did.
  it('commits a cleared duration as null, with Done still enabled', () => {
    open(135);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeEnabled();

    fireEvent.click(done);

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  // Reaching 0:00 by scrolling both columns down means the same thing as pressing Clear. One rule,
  // so neither route can silently round up to 0:01.
  it('treats a wheel scrolled to 0:00 as cleared, not as zero seconds', () => {
    open(30);

    fireEvent.keyDown(secondsCol(), { key: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it('picks a real duration again after clearing', () => {
    open(135);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.keyDown(secondsCol(), { key: '2' });
    fireEvent.keyDown(secondsCol(), { key: '0' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('is titled for a duration, not a clock time', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Set duration' })).toBeInTheDocument();
  });
});
