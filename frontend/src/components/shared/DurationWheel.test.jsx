import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DurationWheel from './DurationWheel';

// jsdom implements neither scroll-snap nor smooth scrolling, so none of this drives the wheel by
// scrolling -- it drives the keyboard interface, which is the point. That interface is not a
// testability affordance bolted on: it is the answer to the objection that killed the old
// NumericKeypad ("pops an unrequested keypad over a mouse-and-keyboard session"), and it is what
// the e2e helper uses too, because scroll-driving a snap container from a test is inherently
// flaky. Assertions are on aria-selected, which is what a screen reader reads and what actually
// says which row is committed.

// A controlled host, so a pick feeds back the way it does in the app. Without this each keypress
// recomputes from the same stale value and multi-digit entry can't be observed at all.
function Harness({ initial = 60, onChange }) {
  const [seconds, setSeconds] = useState(initial);
  return (
    <DurationWheel
      valueSeconds={seconds}
      onChange={(next) => {
        setSeconds(next);
        onChange?.(next);
      }}
    />
  );
}

function minutes() {
  return screen.getByRole('listbox', { name: 'Minutes' });
}
function secondsCol() {
  return screen.getByRole('listbox', { name: 'Seconds' });
}
function selectedIn(listbox) {
  return within(listbox).getByRole('option', { selected: true }).textContent;
}

describe('DurationWheel', () => {
  it('splits the incoming seconds across the two columns', () => {
    render(<Harness initial={135} />);

    expect(selectedIn(minutes())).toBe('2');
    expect(selectedIn(secondsCol())).toBe('15');
  });

  it('emits total seconds when a column changes', () => {
    const onChange = vi.fn();
    render(<Harness initial={60} onChange={onChange} />);

    fireEvent.keyDown(minutes(), { key: 'ArrowDown' });

    expect(onChange).toHaveBeenCalledWith(120);
  });

  it('joins two digits typed in a row into one number', () => {
    const onChange = vi.fn();
    render(<Harness initial={60} onChange={onChange} />);

    fireEvent.keyDown(secondsCol(), { key: '4' });
    fireEvent.keyDown(secondsCol(), { key: '5' });

    // 4 lands first, then the 5 joins it rather than replacing it.
    expect(onChange).toHaveBeenNthCalledWith(1, 64);
    expect(onChange).toHaveBeenNthCalledWith(2, 105);
    expect(selectedIn(secondsCol())).toBe('45');
  });

  // Every digit has to stay meaningful. "9" then "9" cannot be 99 in a 0-59 column, so the second
  // one starts over rather than being swallowed -- the same thing a native picker does.
  it('starts a new number when a second digit would overflow the column', () => {
    render(<Harness initial={0} />);

    fireEvent.keyDown(secondsCol(), { key: '9' });
    fireEvent.keyDown(secondsCol(), { key: '9' });

    expect(selectedIn(secondsCol())).toBe('9');
  });

  it('builds a time across both columns', () => {
    const onChange = vi.fn();
    render(<Harness initial={0} onChange={onChange} />);

    fireEvent.keyDown(minutes(), { key: '2' });
    fireEvent.keyDown(secondsCol(), { key: '1' });
    fireEvent.keyDown(secondsCol(), { key: '5' });

    expect(onChange).toHaveBeenLastCalledWith(135);
    expect(selectedIn(minutes())).toBe('2');
    expect(selectedIn(secondsCol())).toBe('15');
  });

  it('clamps at the ends of a column instead of wrapping', () => {
    render(<Harness initial={0} />);

    fireEvent.keyDown(secondsCol(), { key: 'ArrowUp' });
    expect(selectedIn(secondsCol())).toBe('0');

    fireEvent.keyDown(secondsCol(), { key: 'End' });
    expect(selectedIn(secondsCol())).toBe('59');

    fireEvent.keyDown(secondsCol(), { key: 'ArrowDown' });
    expect(selectedIn(secondsCol())).toBe('59');
  });

  it('steps by ten on PageDown and back to the start on Home', () => {
    render(<Harness initial={60} />);

    fireEvent.keyDown(secondsCol(), { key: 'PageDown' });
    expect(selectedIn(secondsCol())).toBe('10');

    fireEvent.keyDown(secondsCol(), { key: 'Home' });
    expect(selectedIn(secondsCol())).toBe('0');
    expect(selectedIn(minutes())).toBe('1');
  });

  // The wheel is a pure editor with no floor of its own -- the @Min(1) floor lives on the commit
  // (DurationPickerSheet's Done, EditSetModal's Save). Clamping here would snap the wheel back
  // from 0:00 under a finger still moving, and would make the sheet's Clear button a lie.
  it('reaches 0:00, leaving the floor to whoever commits', () => {
    const onChange = vi.fn();
    render(<Harness initial={30} onChange={onChange} />);

    fireEvent.keyDown(secondsCol(), { key: 'Home' });

    expect(onChange).toHaveBeenCalledWith(0);
    expect(selectedIn(secondsCol())).toBe('0');
  });

  it('selects an option that is tapped directly', () => {
    const onChange = vi.fn();
    render(<Harness initial={60} onChange={onChange} />);

    fireEvent.click(within(secondsCol()).getByText('30'));

    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('announces the whole time, not just the column that moved', () => {
    render(<Harness initial={135} />);

    expect(screen.getByRole('status')).toHaveTextContent('2:15');
  });
});
