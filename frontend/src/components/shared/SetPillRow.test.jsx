import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SetPillRow from './SetPillRow';

describe('SetPillRow', () => {
  it('renders nothing when there are no sets', () => {
    const { container } = render(<SetPillRow sets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each set as its own separately-readable pill, not one run-together string', () => {
    render(
      <SetPillRow
        sets={[
          { id: 1, weight: 135, reps: 5, unit: 'lb' },
          { id: 2, weight: 145, reps: 5, unit: 'lb' },
          { id: 3, weight: 155, reps: 3, unit: 'lb' },
        ]}
      />,
    );
    expect(screen.getByText('135lb×5')).toBeInTheDocument();
    expect(screen.getByText('145lb×5')).toBeInTheDocument();
    expect(screen.getByText('155lb×3')).toBeInTheDocument();
  });

  it('renders a plain pill for every set when prFlags is omitted (no regression)', () => {
    render(<SetPillRow sets={[{ id: 1, weight: 135, reps: 5, unit: 'lb' }]} />);
    expect(screen.queryByTitle('Personal record')).not.toBeInTheDocument();
  });

  it('marks only the sets flagged in prFlags as a PR, index-aligned to sets', () => {
    render(
      <SetPillRow
        sets={[
          { id: 1, weight: 135, reps: 5, unit: 'lb' },
          { id: 2, weight: 155, reps: 5, unit: 'lb' },
        ]}
        prFlags={[false, true]}
      />,
    );
    expect(screen.queryByTitle('Personal record')).toBeInTheDocument();
    const prPill = screen.getByTitle('Personal record');
    expect(prPill.textContent).toContain('155lb×5');
    expect(prPill).toHaveAccessibleName('155lb×5, personal record');
    // The non-PR pill has no title/aria-label of its own.
    expect(screen.getByText('135lb×5')).not.toHaveAttribute('title');
  });
});
