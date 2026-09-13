import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OutboxModal from './OutboxModal';

const items = [
  { id: 1, personName: 'Nate', exerciseName: 'Bench Press', detail: 'logged 135 lb × 5' },
  { id: 2, personName: 'Nate', exerciseName: 'Squat', detail: 'logged 225 lb × 3' },
];

describe('OutboxModal', () => {
  it('shows the count in the header and lists each item in order', () => {
    render(<OutboxModal items={items} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.getByText('Waiting to sync (2)')).toBeInTheDocument();
    const rows = screen.getAllByText(/logged/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('logged 135 lb × 5');
    expect(rows[1]).toHaveTextContent('logged 225 lb × 3');
    expect(screen.getByText('Nate — Bench Press')).toBeInTheDocument();
  });

  it('shows an empty state when there is nothing queued', () => {
    render(<OutboxModal items={[]} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()} />);
    expect(screen.getByText('Waiting to sync (0)')).toBeInTheDocument();
    expect(screen.getByText('Nothing queued right now.')).toBeInTheDocument();
  });

  it('omits the exercise name for an item with none (e.g. ending a workout)', () => {
    render(
      <OutboxModal
        items={[{ id: 3, personName: 'Sam', exerciseName: null, detail: 'ended the workout' }]}
        onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  // "Done", not "Close" -- the shared Modal header's X owns the name "Close" now, and two
  // controls with the same accessible name in one dialog is a strict-mode violation.
  it('calls onClose from the Done button', () => {
    const onClose = vi.fn();
    render(<OutboxModal items={items} onClose={onClose} onDiscard={vi.fn()} onClearAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose from the header X', () => {
    const onClose = vi.fn();
    render(<OutboxModal items={items} onClose={onClose} onDiscard={vi.fn()} onClearAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  // The escape hatch. A queued write that can never land had no exit at all before this: the only
  // way out was logging out, which discards the whole outbox and the session with it.
  describe('the escape hatch', () => {
    it('offers Discard on every row, not only the ones marked stuck', () => {
      render(<OutboxModal items={items} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()} />);

      // Gating Discard on the app's own opinion of "stuck" would withhold it in exactly the case
      // nobody predicted, which is the case it exists for.
      expect(screen.getAllByRole('button', { name: /^Discard/ })).toHaveLength(2);
    });

    it('hands the tapped item back to onDiscard', () => {
      const onDiscard = vi.fn();
      render(<OutboxModal items={items} onClose={vi.fn()} onDiscard={onDiscard} onClearAll={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Discard Squat logged 225 lb × 3' }));

      expect(onDiscard).toHaveBeenCalledWith(items[1]);
    });

    it('calls onClearAll from the bulk control', () => {
      const onClearAll = vi.fn();
      render(<OutboxModal items={items} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={onClearAll} />);

      fireEvent.click(screen.getByRole('button', { name: 'Clear all queued changes' }));

      expect(onClearAll).toHaveBeenCalledOnce();
    });

    it('hides the bulk control when there is nothing to clear', () => {
      render(<OutboxModal items={[]} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Clear all queued changes' })).not.toBeInTheDocument();
    });
  });

  // The badge is the whole point of the list being legible: it says WHICH item is the problem.
  // What it must never do is call a write dead because the backend is having a bad day.
  describe("the couldnt-sync marker", () => {
    it('marks a write that can genuinely never land', () => {
      render(
        <OutboxModal
          items={[{ id: 9, personName: 'Nate', exerciseName: 'Squat', detail: 'edited a set to 140 × 3', dead: true }]}
          onClose={vi.fn()}
          onDiscard={vi.fn()}
          onClearAll={vi.fn()}
        />,
      );

      expect(screen.getByText(/Couldn.t sync/)).toBeInTheDocument();
      // And says what to do about it, since "couldn't sync" alone is a dead end.
      expect(screen.getByText(/Discarding it lets the rest through/)).toBeInTheDocument();
    });

    // A write retrying against a 5xx, a cold start, a timeout or an unreachable backend is NOT
    // dead -- it is waiting, and it will land. useOutboxItems derives `dead` through isDeadWrite,
    // which is false for every one of those; this pins that the modal shows nothing alarming for
    // an ordinary queued write.
    it('says nothing alarming about a write that is merely waiting', () => {
      render(<OutboxModal items={items} onClose={vi.fn()} onDiscard={vi.fn()} onClearAll={vi.fn()} />);

      expect(screen.queryByText(/Couldn.t sync/)).not.toBeInTheDocument();
      expect(screen.getByText(/These will send automatically/)).toBeInTheDocument();
    });
  });
});
