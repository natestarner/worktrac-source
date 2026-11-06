import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseAboutStrip from './ExerciseAboutStrip';
import ExerciseAboutSheet from './ExerciseAboutSheet';

const BENCH = { primary: ['chest'], secondary: ['shoulders', 'triceps'] };
const NONE = { primary: [], secondary: [] };

describe('ExerciseAboutStrip', () => {
  function renderStrip(muscles, extra = {}) {
    const onOpen = vi.fn();
    const utils = render(
      <ExerciseAboutStrip
        muscles={muscles}
        bodyFigure={null}
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

  it('keeps the video slot last, and empty when there is no video', () => {
    const { container } = renderStrip(BENCH);
    const strip = container.querySelector('.exercise-strip');
    expect(strip.lastElementChild.className).toBe('exercise-strip-video');
    expect(strip.lastElementChild.childElementCount).toBe(0);
  });
});

describe('ExerciseAboutSheet', () => {
  function renderSheet(props) {
    const onChooseFigure = vi.fn();
    const onClose = vi.fn();
    render(
      <ExerciseAboutSheet exerciseName="Barbell Bench Press" muscles={BENCH} bodyFigure={null} onChooseFigure={onChooseFigure} onClose={onClose} {...props} />,
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
  it('lists main and helping muscles in words', () => {
    renderSheet({ bodyFigure: 'male' });
    expect(screen.getByText('Main muscles')).toBeTruthy();
    expect(screen.getByText('Helping muscles')).toBeTruthy();
    expect(screen.getByText('Shoulders')).toBeTruthy();
    expect(screen.getByText('Triceps')).toBeTruthy();
  });

  it('says so plainly when nothing is listed, without asking about bodies', () => {
    renderSheet({ muscles: NONE });
    expect(screen.getByText('No muscles are listed for this exercise yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Body diagram' })).toBeNull();
  });

  it('closes from its X', () => {
    const { onClose } = renderSheet({ bodyFigure: 'male' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
