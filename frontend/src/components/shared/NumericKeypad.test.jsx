import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NumericKeypad from './NumericKeypad';

// The readout's text is a bare number, which also matches the key buttons -- address it by
// its role instead.
function readout() {
  return screen.getByRole('status').textContent;
}

function press(...keys) {
  keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: k, exact: true })));
}

function renderKeypad(initialValue, onDone = vi.fn()) {
  render(<NumericKeypad label="Weight (lb)" initialValue={initialValue} onCancel={vi.fn()} onDone={onDone} />);
  return onDone;
}

describe('NumericKeypad entry', () => {
  it('shows the current value before anything is typed', () => {
    renderKeypad(135);
    expect(readout()).toBe('135');
  });

  // The bug this closes: digits used to APPEND, so tapping a prefilled 135 and typing 225 gave
  // you 135225. Every exact entry started by backspacing the prefill out first.
  it('replaces the prefilled value with the first digit typed', () => {
    const onDone = renderKeypad(135);

    press('2', '2', '5');
    expect(readout()).toBe('225');

    press('Done');
    expect(onDone).toHaveBeenCalledWith(225);
  });

  it('appends normally after the first keypress', () => {
    const onDone = renderKeypad(135);

    press('9');
    expect(readout()).toBe('9');
    press('5');
    expect(readout()).toBe('95');
    press('⌫');
    expect(readout()).toBe('9');

    press('Done');
    expect(onDone).toHaveBeenCalledWith(9);
  });

  it('clears the whole prefill on a first backspace, rather than deleting one digit', () => {
    renderKeypad(135);

    press('⌫');

    // Falls back to rendering "0" once the buffer is empty.
    expect(readout()).toBe('0');
  });

  it('starts a decimal from scratch when "." is the first key', () => {
    const onDone = renderKeypad(135);

    press('.', '5');
    expect(readout()).toBe('0.5');

    press('Done');
    expect(onDone).toHaveBeenCalledWith(0.5);
  });

  it('accepts a decimal typed after a digit, and only one of them', () => {
    const onDone = renderKeypad(135);

    press('2', '.', '.', '5');
    expect(readout()).toBe('2.5');

    press('Done');
    expect(onDone).toHaveBeenCalledWith(2.5);
  });

  // The blank-weight case: computePrefillDraft returns null when there's no history, so the
  // keypad opens with nothing in it and the first digit is simply the value.
  it('opens empty when there is no value to prefill', () => {
    const onDone = renderKeypad(null);

    expect(readout()).toBe('0');
    press('4', '5', 'Done');
    expect(onDone).toHaveBeenCalledWith(45);
  });

  it('reports 0 when Done is pressed with an empty buffer', () => {
    const onDone = renderKeypad(135);

    press('⌫', 'Done');
    expect(onDone).toHaveBeenCalledWith(0);
  });
});
