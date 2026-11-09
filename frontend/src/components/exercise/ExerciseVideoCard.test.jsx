import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExerciseVideoCard from './ExerciseVideoCard';
import ExerciseAboutSheet from './ExerciseAboutSheet';
import ExerciseVideoSheet from './ExerciseVideoSheet';
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
  it('puts the play button in the strip’s last slot', () => {
    const onPlay = vi.fn();
    const { container } = render(
      <ExerciseAboutStrip
        muscles={BENCH}
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

  // One icon, one sheet (2026-11-08): play opens the video alone, titled with the exercise.
  it('the video sheet holds the video and no muscle diagram', () => {
    render(<ExerciseVideoSheet exerciseName="Barbell Bench Press" video={VIDEO} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Barbell Bench Press' });
    expect(within(sheet).getByRole('region', { name: 'How-to video' })).toBeTruthy();
    expect(within(sheet).queryByText('Primary muscles')).toBeNull();
    expect(within(sheet).queryByRole('group', { name: 'Body diagram' })).toBeNull();
  });

  // The struck-through play button opens this: it says there is no video instead of showing nothing.
  it('the video sheet says when a library exercise has no video yet', () => {
    render(<ExerciseVideoSheet exerciseName="Hammer Curl" video={null} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Hammer Curl' });
    expect(within(sheet).getByText('There’s no how-to video for this exercise yet.')).toBeTruthy();
    expect(within(sheet).queryByRole('region', { name: 'How-to video' })).toBeNull();
  });

  it('the video sheet says your own exercise has no video because videos come with the library', () => {
    render(<ExerciseVideoSheet exerciseName="Qwerty Zorp" video={null} ownExercise onClose={vi.fn()} />);
    expect(screen.getByText(/How-to videos come with exercises from Huddle’s library/)).toBeTruthy();
  });

  it('the muscles sheet, given no video, holds the muscles and no video', () => {
    render(
      <ExerciseAboutSheet
        exerciseName="Barbell Bench Press"
        muscles={BENCH}
        bodyFigure="male"
        onChooseFigure={vi.fn()}
        muscleMap={{ on: true, canChange: true, owner: 'household owner' }}
        onClose={vi.fn()}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Barbell Bench Press' });
    expect(within(sheet).getByText('Primary muscles')).toBeTruthy();
    expect(within(sheet).queryByRole('region', { name: 'How-to video' })).toBeNull();
  });

  // The combined sheet's scroll-to-video pushed the header (and its X) above the screen on iOS
  // Safari. Nothing that opens a sheet may scroll.
  it('opening either sheet scrolls nothing', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<ExerciseVideoSheet exerciseName="Barbell Bench Press" video={VIDEO} onClose={vi.fn()} />);
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
