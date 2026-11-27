import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseSearchScreen from './ExerciseSearchScreen';
// The preview sheet has its own tests; here it only has to open.
vi.mock('../exercise/ExercisePreview', () => ({
  ExercisePreviewSheet: ({ exerciseName }) => <div role="dialog" aria-label={`Preview ${exerciseName}`} />,
}));

const catalog = [
  { id: 11, name: 'Back Squat' },
  { id: 12, name: 'Front Squat' },
  { id: 13, name: 'Bench Press' },
];

// `search` is typed into the field, the way a person does: the text is the screen's own state.
function renderScreen({ search = '', ...props } = {}) {
  const handlers = { onSelectExercise: vi.fn(), onAddExercise: vi.fn(), onCancel: vi.fn() };
  const fieldRef = createRef();
  const view = render(<ExerciseSearchScreen fieldRef={fieldRef} catalog={catalog} loading={false} {...handlers} {...props} />);
  if (search) fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: search } });
  return { ...handlers, fieldRef, view };
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

  // Cancel means "never mind": LogTab unmounts the screen on close, and the next one starts empty.
  it('what was typed goes with the screen: a new one starts empty', () => {
    const { view } = renderScreen({ search: 'ben' });
    expect(screen.getByPlaceholderText('Search all exercises')).toHaveValue('ben');
    view.unmount();
    renderScreen();
    expect(screen.getByPlaceholderText('Search all exercises')).toHaveValue('');
    expect(screen.getByText('All exercises')).toBeInTheDocument();
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

  // Offline (or a failing server) with no library on the device: say so, keep "add your own".
  it('with the library unavailable, says it needs a connection and still offers your own exercise', () => {
    const { onAddExercise } = renderScreen({ catalog: [], unavailable: true });
    expect(screen.getByText('The exercise library needs a connection the first time. You can still add your own exercise.')).toBeInTheDocument();
    expect(screen.queryByText('All exercises')).toBeNull();
    expect(screen.queryByText('No exercises yet. Add your own below.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add your own exercise' }));
    expect(onAddExercise).toHaveBeenCalledWith('');
  });

  it('while loading, shows neither the list nor an empty-library message', () => {
    renderScreen({ catalog: [], loading: true });
    expect(screen.queryByText('All exercises')).toBeNull();
    expect(screen.queryByText('No exercises yet. Add your own below.')).toBeNull();
  });

  it('"Preview exercise" on a result opens its preview', () => {
    renderScreen({ search: 'bench' });
    fireEvent.click(screen.getAllByRole('button', { name: /preview exercise/i })[0]);
    expect(screen.getByRole('dialog', { name: 'Preview Bench Press' })).toBeInTheDocument();
  });
});
