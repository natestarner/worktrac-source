import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseFilterBar from './ExerciseFilterBar';

const chest = { id: 1, name: 'Chest' };
const back = { id: 2, name: 'Back' };

function baseProps(overrides = {}) {
  return {
    text: '',
    onTextChange: vi.fn(),
    tagVocabulary: [],
    selectedTagIds: new Set(),
    onToggleTag: vi.fn(),
    exerciseFilter: null,
    onClearExercise: vi.fn(),
    onClearAll: vi.fn(),
    isActive: false,
    matchCount: 0,
    totalCount: 0,
    ...overrides,
  };
}

describe('ExerciseFilterBar', () => {
  it('hides the tag chip row entirely when no tags are in use', () => {
    render(<ExerciseFilterBar {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Chest' })).not.toBeInTheDocument();
  });

  it('renders tag chips and toggles aria-pressed on click', () => {
    const onToggleTag = vi.fn();
    render(<ExerciseFilterBar {...baseProps({ tagVocabulary: [back, chest], onToggleTag })} />);
    const chestChip = screen.getByRole('button', { name: 'Chest' });
    expect(chestChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chestChip);
    expect(onToggleTag).toHaveBeenCalledWith(chest.id);
  });

  it('reflects an already-selected tag as pressed', () => {
    render(<ExerciseFilterBar {...baseProps({ tagVocabulary: [chest], selectedTagIds: new Set([chest.id]) })} />);
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('only shows the clear-search button when there is text', () => {
    const { rerender } = render(<ExerciseFilterBar {...baseProps()} />);
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();

    rerender(<ExerciseFilterBar {...baseProps({ text: 'bench' })} />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('clicking the clear-search button clears the text', () => {
    const onTextChange = vi.fn();
    render(<ExerciseFilterBar {...baseProps({ text: 'bench', onTextChange })} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(onTextChange).toHaveBeenCalledWith('');
  });

  it('shows the active-exercise pill and a remove control when filtering to one exercise', () => {
    const onClearExercise = vi.fn();
    render(
      <ExerciseFilterBar
        {...baseProps({ exerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press' }, onClearExercise })}
      />,
    );
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Stop filtering to Bench Press'));
    expect(onClearExercise).toHaveBeenCalled();
  });

  it('shows Clear all and a match count only when a filter is active', () => {
    const { rerender } = render(<ExerciseFilterBar {...baseProps()} />);
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();

    rerender(<ExerciseFilterBar {...baseProps({ isActive: true, text: 'bench', matchCount: 2, totalCount: 10 })} />);
    expect(screen.getByText('Clear all')).toBeInTheDocument();
    expect(screen.getByText('2 of 10')).toBeInTheDocument();
  });
});
