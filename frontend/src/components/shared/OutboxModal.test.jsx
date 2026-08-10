import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OutboxModal from './OutboxModal';

const items = [
  { id: 1, personName: 'Nate', exerciseName: 'Bench Press', detail: 'logged 135 lb × 5' },
  { id: 2, personName: 'Nate', exerciseName: 'Squat', detail: 'logged 225 lb × 3' },
];

describe('OutboxModal', () => {
  it('shows the count in the header and lists each item in order', () => {
    render(<OutboxModal items={items} onClose={vi.fn()} />);

    expect(screen.getByText('Waiting to sync (2)')).toBeInTheDocument();
    const rows = screen.getAllByText(/logged/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('logged 135 lb × 5');
    expect(rows[1]).toHaveTextContent('logged 225 lb × 3');
    expect(screen.getByText('Nate — Bench Press')).toBeInTheDocument();
  });

  it('shows an empty state when there is nothing queued', () => {
    render(<OutboxModal items={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Waiting to sync (0)')).toBeInTheDocument();
    expect(screen.getByText('Nothing queued right now.')).toBeInTheDocument();
  });

  it('omits the exercise name for an item with none (e.g. ending a workout)', () => {
    render(
      <OutboxModal
        items={[{ id: 3, personName: 'Sam', exerciseName: null, detail: 'ended the workout' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  // "Done", not "Close" -- the shared Modal header's X owns the name "Close" now, and two
  // controls with the same accessible name in one dialog is a strict-mode violation.
  it('calls onClose from the Done button', () => {
    const onClose = vi.fn();
    render(<OutboxModal items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose from the header X', () => {
    const onClose = vi.fn();
    render(<OutboxModal items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
