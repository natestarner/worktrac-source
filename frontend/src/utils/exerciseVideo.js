import { getEmbedOrigin } from '../config';

// A library exercise's how-to video, as the catalog carries it (`exercise.video`, backend V94):
// `{ provider, videoId, startSeconds, sourceLabel }`, or null.
//
// The server sends an id, never a URL, and the app builds the only two URLs it ever uses from it:
// its own embed page (public/embed/youtube.html, which validates the id again) and a plain YouTube
// watch link. Anything that is not a YouTube id is treated as no video at all, so a malformed row,
// a provider this build does not know, or a catalog cached before videos existed all read as "no
// video" -- the slot stays empty and nothing else changes.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function exerciseVideo(exercise) {
  const video = exercise?.video;
  if (!video || video.provider !== 'youtube' || !VIDEO_ID.test(video.videoId ?? '')) return null;
  const start = Number.isInteger(video.startSeconds) && video.startSeconds > 0 ? video.startSeconds : null;
  return {
    videoId: video.videoId,
    startSeconds: start,
    sourceLabel: (video.sourceLabel ?? '').trim() || 'YouTube',
  };
}

// The player: this app's own embed page, muted and playing (the tap that loads it is the gesture
// that allows it). In the App Store app the origin is the web host (config.js#getEmbedOrigin).
export function embedSrc(video) {
  const params = new URLSearchParams({ v: video.videoId });
  if (video.startSeconds) params.set('start', String(video.startSeconds));
  params.set('mute', '1');
  return `${getEmbedOrigin()}/embed/youtube.html?${params}`;
}

// The same video on YouTube itself, for "Open on YouTube".
export function watchUrl(video) {
  const params = new URLSearchParams({ v: video.videoId });
  if (video.startSeconds) params.set('t', `${video.startSeconds}s`);
  return `https://www.youtube.com/watch?${params}`;
}
