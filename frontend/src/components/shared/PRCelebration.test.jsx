import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PRCelebration from './PRCelebration';
import { useUI } from '../../context/UIContext';

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

describe('PRCelebration', () => {
  it('renders nothing when there is no active celebration', () => {
    useUI.mockReturnValue({ celebration: null, dismissCelebration: vi.fn() });
    const { container } = render(<PRCelebration />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the weight/1RM calc for a weighted PR', () => {
    useUI.mockReturnValue({
      celebration: {
        exerciseName: 'Bench Press',
        isBodyweight: false,
        setText: '185 lb × 5',
        est1rmText: '208 lb',
      },
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('208 lb')).toBeInTheDocument();
    expect(screen.getByText(/Est\. 1RM/)).toBeInTheDocument();
    expect(screen.getByText(/185 lb × 5/)).toBeInTheDocument();
  });

  it('shows reps instead of the weight/1RM calc for a bodyweight PR', () => {
    useUI.mockReturnValue({
      celebration: {
        exerciseName: 'Pull-Up',
        isBodyweight: true,
        setText: '0 lb × 12',
        est1rmText: '12 reps',
      },
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('12 reps')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    expect(screen.queryByText(/Est\. 1RM/)).not.toBeInTheDocument();
  });
});
