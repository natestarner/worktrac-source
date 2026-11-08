import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExerciseVideoCard from './ExerciseVideoCard';
import ExerciseAboutSheet from './ExerciseAboutSheet';
import ExerciseAboutStrip from './ExerciseAboutStrip';

const VIDEO = { videoId: 'j7ULT6dznNc', startSeconds: 12, sourceLabel: 'Muscle & Strength' };
const BENCH = { primary: ['chest'], secondary: ['shoulders', 'triceps'] };

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('ExerciseVideoCard', () => {
  it('fetches nothing until the play button is tapped', () => {
    const { container } = render(<ExerciseVideoCard video={VIDEO} exerciseName="Barbell Bench Press" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the video' })).toBeTruthy();
  });

  it('plays this app’s own embed page, muted, when tapped', () => {
    render(<ExerciseVideoCard video={VIDEO} exerciseName="Barbell Bench Press" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play the video' }));
    const frame = screen.getByTitle('How-to video: Barbell Bench Press');
    expect(frame.getAttribute('src')).toBe('/embed/youtube.html?v=j7ULT6dznNc&start=12&mute=1');
  });

  it('names who made the video and links to it on YouTube', () => {
    render(<ExerciseVideoCard video={VIDEO} exerciseName="Barbell Bench Press" />);
    expect(screen.getByText(/Video: Muscle & Strength on YouTube\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open on YouTube' }).getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=j7ULT6dznNc&t=12s',
    );
  });

  // The one connectivity branch (resilience.md's register): the player is YouTube's own page.
  it('says it needs a connection when offline, and keeps the credit', () => {
    act(() => onlineManager.setOnline(false));
    render(<ExerciseVideoCard video={VIDEO} exerciseName="Barbell Bench Press" />);
    expect(screen.queryByRole('button', { name: 'Play the video' })).toBeNull();
    expect(screen.getByText('The video needs a connection.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open on YouTube' })).toBeTruthy();
  });

  it('renders nothing for an exercise with no video', () => {
    const { container } = render(<ExerciseVideoCard video={null} exerciseName="Qwerty Zorp" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the video in the strip and the sheet', () => {
  it('puts a play button in the strip’s last slot only when there is a video', () => {
    const onPlay = vi.fn();
    const { container } = render(
      <ExerciseAboutStrip
        muscles={BENCH}
        bodyFigure={null}
        onOpen={vi.fn()}
        actions={null}
        video={<button type="button" onClick={onPlay}>Show how-to video</button>}
      />,
    );
    const slot = container.querySelector('.exercise-strip').lastElementChild;
    expect(slot.className).toBe('exercise-strip-video');
    fireEvent.click(screen.getByRole('button', { name: 'Show how-to video' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('shows the video below the muscles in the sheet, and scrolls to it when opened from play', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <ExerciseAboutSheet
        exerciseName="Barbell Bench Press"
        muscles={BENCH}
        bodyFigure="male"
        onChooseFigure={vi.fn()}
        muscleMap={{ on: true, canChange: true, owner: 'household owner' }}
        onClose={vi.fn()}
        video={VIDEO}
        focusVideo
      />,
    );
    expect(screen.getByRole('region', { name: 'How-to video' })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    delete Element.prototype.scrollIntoView;
  });

  it('does not scroll when the sheet was opened from the body', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <ExerciseAboutSheet
        exerciseName="Barbell Bench Press"
        muscles={BENCH}
        bodyFigure="male"
        onChooseFigure={vi.fn()}
        muscleMap={{ on: true, canChange: true, owner: 'household owner' }}
        onClose={vi.fn()}
        video={VIDEO}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    delete Element.prototype.scrollIntoView;
  });
});
