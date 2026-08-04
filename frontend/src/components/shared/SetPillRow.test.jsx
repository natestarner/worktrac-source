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
});
