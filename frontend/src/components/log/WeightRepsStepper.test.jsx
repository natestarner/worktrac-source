import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WeightRepsStepper from './WeightRepsStepper';

// Replaces NumericKeypad.test.jsx -- the modal keypad these cases used to cover is gone; the
// same "replace, don't append" and "0 on empty" guarantees now live on the stepper's own
// input. See the component's header comment and docs/exercise-favorites-redesign.md's
// 2026-08-10 entry for why.

function input(label = 'Weight (lb)') {
  return screen.getByLabelText(label);
}

describe('WeightRepsStepper value input', () => {
  it('shows the current value and calls onDec/onInc unchanged', () => {
    const onDec = vi.fn();
    const onInc = vi.fn();
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={onDec} onInc={onInc} onChange={vi.fn()} />);

    expect(input()).toHaveValue('135');
    fireEvent.click(screen.getByTitle('Decrease Weight (lb)'));
    fireEvent.click(screen.getByTitle('Increase Weight (lb)'));
    expect(onDec).toHaveBeenCalledTimes(1);
    expect(onInc).toHaveBeenCalledTimes(1);
  });

  // The bug this closes: a plain input puts the caret at the END of a prefilled value, so typing
  // a replacement APPENDS ("tap 135, type 225" produced 135225) instead of replacing it. Focus
  // selecting the whole value is what makes the next keystroke replace it -- this asserts the
  // actual selection range a real keystroke would then type over, not just that some handler ran.
  it('selects the whole prefilled value on focus, so the next keystroke replaces rather than appends', () => {
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} onChange={vi.fn()} />);

    input().focus();

    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe('135'.length);
  });

  it('commits the parsed value on blur, not on every keystroke', () => {
    const onChange = vi.fn();
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} onChange={onChange} />);

    input().focus();
    fireEvent.change(input(), { target: { value: '225' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input());
    expect(onChange).toHaveBeenCalledWith(225);
  });

  // Mirrors the old keypad's explicit "Done": a plain controlled input re-renders with the
  // PARSED value on every keystroke, which strips a trailing "." the instant it's typed and makes
  // a decimal impossible to enter digit by digit. Buffering locally while focused avoids that.
  it('keeps a trailing decimal point while typing instead of stripping it on every render', () => {
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} onChange={vi.fn()} />);

    input().focus();
    fireEvent.change(input(), { target: { value: '2.' } });
    expect(input()).toHaveValue('2.');

    fireEvent.change(input(), { target: { value: '2.5' } });
    expect(input()).toHaveValue('2.5');
  });

  it('Enter commits the same way blur does', () => {
    const onChange = vi.fn();
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} onChange={onChange} />);

    input().focus();
    fireEvent.change(input(), { target: { value: '95' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(95);
  });

  it('reports 0 when the field is cleared and blurred, matching the old keypad Done-on-empty behaviour', () => {
    const onChange = vi.fn();
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} onChange={onChange} />);

    input().focus();
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());

    expect(onChange).toHaveBeenCalledWith(0);
  });

  // The blank-weight case: computePrefillDraft returns null when there's no history, so the
  // field renders empty with an em dash placeholder rather than a number.
  it('renders a null value as an empty field with an em dash placeholder', () => {
    render(<WeightRepsStepper label="Weight (lb)" value={null} onDec={vi.fn()} onInc={vi.fn()} onChange={vi.fn()} />);

    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('placeholder', '—');
  });

  it('falls back to a plain, non-editable value display when no onChange is supplied', () => {
    render(<WeightRepsStepper label="Weight (lb)" value={135} onDec={vi.fn()} onInc={vi.fn()} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('135')).toBeInTheDocument();
  });
});
