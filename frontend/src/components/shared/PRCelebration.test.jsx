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
        caption: 'Est. 1RM · 185 lb × 5',
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
        caption: 'Bodyweight',
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

  // THE REGRESSION. The caption used to be a boolean this component turned into the literal word
  // "Bodyweight", and ExerciseDetail set it for every hold -- so a hold logged WITH weight on it
  // was captioned "Bodyweight", contradicting the number the person had just typed.
  it('names the load on a weighted hold instead of calling it bodyweight', () => {
    useUI.mockReturnValue({
      celebration: {
        exerciseName: 'Weighted Plank',
        caption: 'Weighted · 25 lb',
        setText: '25 lb × 1:00',
        est1rmText: '1:00 hold',
      },
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('1:00 hold')).toBeInTheDocument();
    expect(screen.getByText('Weighted · 25 lb')).toBeInTheDocument();
    expect(screen.queryByText('Bodyweight')).not.toBeInTheDocument();
  });

  // The other half: an unweighted hold IS a bodyweight hold, so that caption stays correct there.
  // Only the weighted case was ever wrong.
  it('still says bodyweight for a hold with no weight on it', () => {
    useUI.mockReturnValue({
      celebration: {
        exerciseName: 'Plank',
        caption: 'Bodyweight',
        setText: '1:00',
        est1rmText: '1:00 hold',
      },
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('1:00 hold')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
  });
});
