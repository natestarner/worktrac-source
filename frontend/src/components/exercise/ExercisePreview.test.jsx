import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExercisePreviewContent, ExercisePreviewSheet } from './ExercisePreview';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import { useAppState } from '../../context/AppStateContext';
import { useExercises } from '../../hooks/useExercises';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));

const BENCH = {
  id: 7,
  name: 'Barbell Bench Press',
  isGlobal: true,
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  video: { provider: 'youtube', videoId: 'abcdefghijk', startSeconds: 4, sourceLabel: 'Muscle & Strength' },
};

describe('previewing an exercise', () => {
  const setBodyFigure = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ bodyFigure: 'male', setBodyFigure });
    useExercises.mockReturnValue({ exercises: [BENCH] });
  });

  it('shows the muscles and the video the Log screen would, from the catalog row', () => {
    render(<ExercisePreviewSheet exerciseId={7} exerciseName="Barbell Bench Press" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Barbell Bench Press' });
    expect(within(dialog).getByText('Chest')).toBeTruthy();
    expect(within(dialog).getByText('Triceps')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Play the video' })).toBeTruthy();
  });

  it('is a preview, not an editor: no way to add muscles from here', () => {
    useExercises.mockReturnValue({ exercises: [{ id: 9, name: 'My Curl', isGlobal: false }] });
    render(<ExercisePreviewSheet exerciseId={9} exerciseName="My Curl" onClose={vi.fn()} />);
    expect(screen.getByText('No muscles are listed for this exercise yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add muscles worked' })).toBeNull();
  });

  // A catalog cached before the fields existed, or one that doesn't hold the row yet.
  it('falls back to the name it was given when the catalog lacks the row', () => {
    useExercises.mockReturnValue({ exercises: [] });
    render(<ExercisePreviewSheet exerciseId={42} exerciseName="Zottman Curl" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Zottman Curl' })).toBeTruthy();
    expect(screen.getByText('No muscles are listed for this exercise yet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'How-to video' })).toBeNull();
  });

  it('changes the person’s body figure, the same preference as the Log screen', () => {
    render(<ExercisePreviewContent exerciseId={7} exerciseName="Barbell Bench Press" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show a female body' }));
    expect(setBodyFigure).toHaveBeenCalledWith('female');
  });
});

describe('the Preview exercise button on a search result', () => {
  it('opens the preview without choosing the exercise', () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn();
    render(<ExerciseSearchResults results={[BENCH]} term="bench" onSelect={onSelect} onPreview={onPreview} emptyMessage="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview exercise' }));
    expect(onPreview).toHaveBeenCalledWith(BENCH);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Specs click a result by its exercise's name, and Playwright matches names by substring.
  it('keeps the exercise name out of its accessible name, and says it as a description', () => {
    render(<ExerciseSearchResults results={[BENCH]} term="bench" onSelect={vi.fn()} onPreview={vi.fn()} emptyMessage="" />);
    const preview = screen.getByRole('button', { name: 'Preview exercise' });
    expect(preview.getAttribute('aria-label')).not.toContain('Bench');
    expect(screen.getByRole('button', { name: 'Barbell Bench Press' })).toBeTruthy();
    // Described by the result row itself, whose accessible name is the exercise's name.
    // (dom-accessibility-api reads a described-by target's text rather than its aria-label, so the
    // wiring is asserted directly; browsers follow the spec and read the label.)
    expect(document.getElementById(preview.getAttribute('aria-describedby'))).toBe(
      screen.getByRole('button', { name: 'Barbell Bench Press' }),
    );
  });

  it('is not there unless the caller asks for it', () => {
    render(<ExerciseSearchResults results={[BENCH]} term="bench" onSelect={vi.fn()} emptyMessage="" />);
    expect(screen.queryByRole('button', { name: 'Preview exercise' })).toBeNull();
  });
});
