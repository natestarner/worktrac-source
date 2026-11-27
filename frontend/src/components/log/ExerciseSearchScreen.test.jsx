import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseSearchScreen from './ExerciseSearchScreen';
import { useAppState } from '../../context/AppStateContext';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
// The preview sheet has its own tests; here it only has to open.
vi.mock('../exercise/ExercisePreview', () => ({
  ExercisePreviewSheet: ({ exerciseName }) => <div role="dialog" aria-label={`Preview ${exerciseName}`} />,
}));

const catalog = [
  { id: 11, name: 'Back Squat' },
  { id: 12, name: 'Front Squat' },
  { id: 13, name: 'Bench Press' },
];

function renderScreen({ search = '', ...props } = {}) {
  const setExerciseSearch = vi.fn();
  useAppState.mockReturnValue({ exerciseSearch: search, setExerciseSearch });
  const handlers = { onSelectExercise: vi.fn(), onAddExercise: vi.fn(), onCancel: vi.fn() };
  const fieldRef = createRef();
  render(<ExerciseSearchScreen fieldRef={fieldRef} catalog={catalog} loading={false} {...handlers} {...props} />);
  return { ...handlers, setExerciseSearch, fieldRef };
}

describe('ExerciseSearchScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a region named "Exercise search" holding the field, Cancel and the results', () => {
    const { fieldRef } = renderScreen({ search: 'squ' });
    const region = screen.getByRole('region', { name: 'Exercise search' });
    const field = within(region).getByPlaceholderText('Search all exercises');
    expect(fieldRef.current, 'LogTab focuses this field in the tap').toBe(field);
    // `.input` holds the 16px floor that keeps iOS Safari from zooming on focus.
    expect(field).toHaveClass('input');
    expect(within(region).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(region).getByText('Search results')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Back Squat' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Bench Press' })).toBeNull();
  });

  it('with nothing typed, lists every exercise A-Z under "All exercises", and says what can be searched', () => {
    const { onSelectExercise } = renderScreen();
    expect(screen.getByText('Search by name, another name for it, or a muscle it works.')).toBeInTheDocument();
    expect(screen.getByText('All exercises')).toBeInTheDocument();
    expect(screen.queryByText('Search results')).toBeNull();
    const names = screen.getAllByRole('button', { name: /Squat|Press/ }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Back Squat', 'Bench Press', 'Front Squat']);
    fireEvent.click(screen.getByRole('button', { name: 'Front Squat' }));
    expect(onSelectExercise).toHaveBeenCalledWith(12);
  });

  it('typing narrows the list to the matches, and the hint goes', () => {
    renderScreen({ search: 'squat' });
    expect(screen.getByText('Search results')).toBeInTheDocument();
    expect(screen.queryByText('All exercises')).toBeNull();
    expect(screen.queryByText('Search by name, another name for it, or a muscle it works.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bench Press' })).toBeNull();
  });

  it('typing writes the person’s draft', () => {
    const { setExerciseSearch } = renderScreen();
    fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: 'ben' } });
    expect(setExerciseSearch).toHaveBeenCalledWith('ben');
  });

  it('choosing a result hands it to LogTab', () => {
    const { onSelectExercise } = renderScreen({ search: 'bench' });
    fireEvent.click(screen.getByRole('button', { name: 'Bench Press' }));
    expect(onSelectExercise).toHaveBeenCalledWith(13);
  });

  it('"+ Add your own exercise" starts from what was typed', () => {
    const { onAddExercise } = renderScreen({ search: 'zercher' });
    fireEvent.click(screen.getByRole('button', { name: '+ Add your own exercise' }));
    expect(onAddExercise).toHaveBeenCalledWith('zercher');
  });

  it('Cancel and Escape both cancel', () => {
    const { onCancel } = renderScreen({ search: 'squ' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Search all exercises'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  // The keyboard's Search key puts the keyboard away so every result can be seen.
  it('the Search key takes the focus off the field (the keyboard goes) and cancels nothing', () => {
    const { onCancel } = renderScreen({ search: 'squ' });
    const field = screen.getByPlaceholderText('Search all exercises');
    field.focus();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(document.activeElement).not.toBe(field);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('"Preview exercise" on a result opens its preview', () => {
    renderScreen({ search: 'bench' });
    fireEvent.click(screen.getAllByRole('button', { name: /preview exercise/i })[0]);
    expect(screen.getByRole('dialog', { name: 'Preview Bench Press' })).toBeInTheDocument();
  });
});
