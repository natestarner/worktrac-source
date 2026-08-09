import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SegmentedToggle from './SegmentedToggle';

const OPTIONS = [
  { label: 'Volume', value: 'volume' },
  { label: 'Sets', value: 'sets' },
  { label: 'Reps', value: 'reps' },
];

describe('SegmentedToggle', () => {
  it('renders one button per option', () => {
    render(<SegmentedToggle options={OPTIONS} value="volume" onChange={vi.fn()} ariaLabel="Weekly metric" />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('marks exactly the selected option as pressed', () => {
    render(<SegmentedToggle options={OPTIONS} value="sets" onChange={vi.fn()} ariaLabel="Weekly metric" />);

    expect(screen.getByRole('button', { name: 'Sets' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Volume' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the option value, not its label', () => {
    const onChange = vi.fn();
    render(<SegmentedToggle options={OPTIONS} value="volume" onChange={onChange} ariaLabel="Weekly metric" />);

    fireEvent.click(screen.getByRole('button', { name: 'Reps' }));
    expect(onChange).toHaveBeenCalledWith('reps');
  });

  it('groups the buttons under its label so the control is announced as one thing', () => {
    render(<SegmentedToggle options={OPTIONS} value="volume" onChange={vi.fn()} ariaLabel="Weekly metric" />);
    expect(screen.getByRole('group', { name: 'Weekly metric' })).toBeInTheDocument();
  });

  it('works with numeric values, as the range toggle uses', () => {
    const onChange = vi.fn();
    render(
      <SegmentedToggle
        options={[
          { label: '4wk', value: 4 },
          { label: 'All', value: 260 },
        ]}
        value={4}
        onChange={onChange}
        ariaLabel="Time range"
      />,
    );

    expect(screen.getByRole('button', { name: '4wk' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith(260);
  });
});
