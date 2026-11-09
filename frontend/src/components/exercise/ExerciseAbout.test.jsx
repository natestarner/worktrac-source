import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ExerciseAboutStrip from './ExerciseAboutStrip';
import ExerciseAboutSheet, { ExerciseAboutContent } from './ExerciseAboutSheet';

const BENCH = { primary: ['chest'], secondary: ['shoulders', 'triceps'] };
const NONE = { primary: [], secondary: [] };
const ON = { on: true, canChange: true, owner: 'household owner' };
const OFF = { on: false, canChange: true, owner: 'household owner' };

describe('ExerciseAboutStrip', () => {
  function renderStrip(muscles, extra = {}) {
    const onOpen = vi.fn();
    const utils = render(
      <ExerciseAboutStrip
        muscles={muscles}
        onOpen={onOpen}
        actions={<button type="button">Customize this exercise</button>}
        {...extra}
      />,
    );
    return { onOpen, ...utils };
  }

  it('opens the sheet from a button that names the muscles', () => {
    const { onOpen } = renderStrip(BENCH);
    fireEvent.click(screen.getByRole('button', { name: 'About this exercise: works Chest, helped by Shoulders and Triceps' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chest')).toBeTruthy();
  });

  // The strip's box must be the same whether or not the exercise has muscles -- a custom exercise,
  // a temp row created offline, a catalog cached before the fields existed. The steppers sit below.
  it('renders the same slots for an exercise with no muscles', () => {
    const withMuscles = renderStrip(BENCH);
    const slots = withMuscles.container.querySelector('.exercise-strip').children.length;
    withMuscles.unmount();

    const without = renderStrip(NONE);
    expect(without.container.querySelector('.exercise-strip').children.length).toBe(slots);
    expect(screen.getByRole('button', { name: 'About this exercise' })).toBeTruthy();
  });

  it('keeps the video slot last', () => {
    const { container } = renderStrip(BENCH, { video: <button type="button">No how-to video</button> });
    const strip = container.querySelector('.exercise-strip');
    expect(strip.lastElementChild.className).toBe('exercise-strip-video');
    expect(strip.lastElementChild.textContent).toBe('No how-to video');
  });

  // The About button is an 18px glyph like the actions beside it (2026-11-08), not the shaded body
  // thumbnail it replaced, which stood taller than its neighbours.
  it('draws the About button as an 18px glyph, not a body diagram', () => {
    const { container } = renderStrip(BENCH);
    const icon = container.querySelector('.exercise-strip-about svg');
    expect(icon.getAttribute('width')).toBe('18');
    expect(icon.getAttribute('height')).toBe('18');
    expect(container.querySelector('.body-map')).toBeNull();
  });
});

describe('ExerciseAboutSheet', () => {
  function renderSheet(props) {
    const onChooseFigure = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ExerciseAboutSheet exerciseName="Barbell Bench Press" muscles={BENCH} bodyFigure={null} onChooseFigure={onChooseFigure} onClose={onClose} muscleMap={ON} {...props} />
      </MemoryRouter>,
    );
    return { onChooseFigure, onClose };
  }

  it('asks which body to draw the first time, and reports the choice', () => {
    const { onChooseFigure } = renderSheet();
    expect(screen.getByText('Which body should the muscle diagram show?')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Front of the body' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show a female body' }));
    expect(onChooseFigure).toHaveBeenCalledWith('female');
  });

  it('draws front and back once a body is chosen, with the switch still offered', () => {
    renderSheet({ bodyFigure: 'male' });
    expect(screen.getByRole('img', { name: 'Front of the body' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Back of the body' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show a male body' }).getAttribute('aria-pressed')).toBe('true');
  });

  // Colour is never the only carrier: every muscle is also named, under its role.
  it('lists primary and secondary muscles in words', () => {
    renderSheet({ bodyFigure: 'male' });
    expect(screen.getByText('Primary muscles')).toBeTruthy();
    expect(screen.getByText('Secondary muscles')).toBeTruthy();
    expect(screen.getByText('Shoulders')).toBeTruthy();
    expect(screen.getByText('Triceps')).toBeTruthy();
  });

  it('says so plainly when nothing is listed, without asking about bodies', () => {
    renderSheet({ muscles: NONE });
    expect(screen.getByText('No muscles are listed for this exercise yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Body diagram' })).toBeNull();
  });

  it('offers to describe an undescribed exercise when the caller allows it', () => {
    const onAddMuscles = vi.fn();
    renderSheet({ muscles: NONE, onAddMuscles });
    fireEvent.click(screen.getByRole('button', { name: 'Add muscles worked' }));
    expect(onAddMuscles).toHaveBeenCalled();
  });

  it('offers nothing to add when the caller does not (a library exercise, a temp row)', () => {
    renderSheet({ muscles: NONE });
    expect(screen.queryByRole('button', { name: 'Add muscles worked' })).toBeNull();
  });

  it('closes from its X', () => {
    const { onClose } = renderSheet({ bodyFigure: 'male' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  // The muscle highlighter is off: the note, with a link to Settings, stands where the bodies,
  // the question and the switch would be. The muscle names stay -- they are text.
  it('shows the note instead of the diagram while the muscle highlighter is off', () => {
    renderSheet({ bodyFigure: 'male', muscleMap: OFF });
    expect(screen.queryByRole('img', { name: 'Front of the body' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Body diagram' })).toBeNull();
    expect(screen.getByTestId('muscle-map-off')).toHaveTextContent(
      'The muscle highlighter is off by default. To turn it on, visit the Settings page.',
    );
    expect(screen.getByRole('link', { name: 'Settings page' })).toHaveAttribute('href', '/app/settings');
    expect(screen.getByText('Primary muscles')).toBeTruthy();
    expect(screen.getByText('Triceps')).toBeTruthy();
  });

  it('does not ask which body to draw while it is off', () => {
    renderSheet({ bodyFigure: null, muscleMap: OFF });
    expect(screen.queryByText('Which body should the muscle diagram show?')).toBeNull();
  });

  // Only the owner can turn it on, so anyone else is told who can.
  it('names who can turn it on when this login cannot', () => {
    renderSheet({ bodyFigure: 'male', muscleMap: { on: false, canChange: false, owner: 'trainer' } });
    expect(screen.getByTestId('muscle-map-off')).toHaveTextContent(
      'The muscle highlighter is off by default. Your trainer can turn it on from the Settings page.',
    );
  });

  // The routine editor's preview: leaving would throw the unsaved routine away.
  it('names Settings without linking there when the caller says leaving would lose work', () => {
    render(
      <ExerciseAboutContent exerciseName="Barbell Bench Press" muscles={BENCH} bodyFigure="male" onChooseFigure={vi.fn()} muscleMap={OFF} settingsLink={false} />,
    );
    expect(screen.getByTestId('muscle-map-off')).toHaveTextContent('visit the Settings page.');
    expect(screen.queryByRole('link')).toBeNull();
  });

  // A caller that forgets the prop gets the note, never a body.
  it('is off when no setting is passed', () => {
    render(
      <MemoryRouter>
        <ExerciseAboutContent exerciseName="Barbell Bench Press" muscles={BENCH} bodyFigure="male" onChooseFigure={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('img', { name: 'Front of the body' })).toBeNull();
    expect(screen.getByTestId('muscle-map-off')).toBeTruthy();
  });
});
