import { describe, expect, it } from 'vitest';
import { embedSrc, exerciseVideo, watchUrl } from './exerciseVideo';

const row = (video) => ({ id: 1, name: 'Barbell Bench Press', video });
const VIDEO = { provider: 'youtube', videoId: 'j7ULT6dznNc', startSeconds: 12, sourceLabel: 'Muscle & Strength' };

describe('exerciseVideo', () => {
  it('reads a YouTube video off the catalog row', () => {
    expect(exerciseVideo(row(VIDEO))).toEqual({ videoId: 'j7ULT6dznNc', startSeconds: 12, sourceLabel: 'Muscle & Strength' });
  });

  // A catalog cached before videos existed, a custom exercise, a temp row created offline.
  it('answers null for a row with no video', () => {
    expect(exerciseVideo(row(null))).toBeNull();
    expect(exerciseVideo(row(undefined))).toBeNull();
    expect(exerciseVideo({ id: 'temp-exercise-1', name: 'X' })).toBeNull();
    expect(exerciseVideo(undefined)).toBeNull();
  });

  it('treats anything that is not a YouTube id as no video', () => {
    expect(exerciseVideo(row({ ...VIDEO, provider: 'vimeo' }))).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, videoId: 'https://evil.example/' }))).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, videoId: 'short' }))).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, videoId: undefined }))).toBeNull();
  });

  it('drops a start that is not a positive whole second, and names YouTube when no one is named', () => {
    expect(exerciseVideo(row({ ...VIDEO, startSeconds: 0 })).startSeconds).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, startSeconds: -4 })).startSeconds).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, startSeconds: 1.5 })).startSeconds).toBeNull();
    expect(exerciseVideo(row({ ...VIDEO, sourceLabel: ' ' })).sourceLabel).toBe('YouTube');
  });
});

describe('embedSrc', () => {
  // On the web the embed page is on this origin; config.js#getEmbedOrigin answers '' until a
  // config.json names another (the App Store app's does).
  it('is this app’s own embed page, muted, starting where the demonstration starts', () => {
    expect(embedSrc(exerciseVideo(row(VIDEO)))).toBe('/embed/youtube.html?v=j7ULT6dznNc&start=12&mute=1');
  });

  it('leaves the start off when there is none', () => {
    expect(embedSrc(exerciseVideo(row({ ...VIDEO, startSeconds: null })))).toBe('/embed/youtube.html?v=j7ULT6dznNc&mute=1');
  });
});

describe('watchUrl', () => {
  it('is the video on YouTube, at the same start', () => {
    expect(watchUrl(exerciseVideo(row(VIDEO)))).toBe('https://www.youtube.com/watch?v=j7ULT6dznNc&t=12s');
  });
});
