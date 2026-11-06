import { afterEach, describe, expect, it } from 'vitest';
import webAppConfig from '../public/staticwebapp.config.json';
import embedScript from '../public/embed/youtube.js?raw';

// public/embed/youtube.html is the one page on the app's origin that another document may frame:
// the App Store app shows it so YouTube sees a real https embedder (its header explains error 153).
// These pin the two halves that make it safe to be the exception, and the one that makes it work.

const embedRoute = webAppConfig.routes.find((r) => r.route === '/embed/*');
const embedCsp = embedRoute?.headers?.['Content-Security-Policy'] ?? '';
const directive = (name) =>
  embedCsp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? '';

describe('the YouTube embed page on the web host', () => {
  it('is served as itself, never as the app shell', () => {
    expect(webAppConfig.navigationFallback.exclude).toContain('/embed/*');
  });

  it('may be framed only by this origin and the App Store app', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self' capacitor://localhost");
  });

  it('frames YouTube and nothing else, and runs only its own script', () => {
    expect(directive('frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://www.youtube.com');
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('default-src')).toBe("default-src 'none'");
  });

  // The app frames this page itself (the exercise sheet's video), so the app's own CSP must let
  // it: frame-src is set explicitly there, so default-src 'self' does not cover frames.
  it('may be framed by the app on the same origin', () => {
    const global = webAppConfig.globalHeaders['Content-Security-Policy'];
    const frameSrc = global.split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-src '));
    expect(frameSrc.split(' ')).toContain("'self'");
  });

  it('leaves the rest of the site unframeable', () => {
    const global = webAppConfig.globalHeaders['Content-Security-Policy'];
    expect(global).toContain("frame-ancestors 'none'");
    expect(webAppConfig.globalHeaders['X-Frame-Options']).toBe('DENY');
  });
});

describe('youtube.js', () => {
  const run = (search) => {
    window.history.replaceState(null, '', `/embed/youtube.html${search}`);
    document.body.innerHTML = '';
    new Function(embedScript)();
    return document.body;
  };

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  it('frames the video from youtube-nocookie.com by default', () => {
    const frame = run('?v=j7ULT6dznNc').querySelector('iframe');
    expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/j7ULT6dznNc?playsinline=1&rel=0');
    expect(frame.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(frame.allowFullscreen).toBe(true);
  });

  it('uses youtube.com when asked', () => {
    const frame = run('?v=j7ULT6dznNc&host=youtube').querySelector('iframe');
    expect(frame.src).toBe('https://www.youtube.com/embed/j7ULT6dznNc?playsinline=1&rel=0');
  });

  it('starts at a given second, and muted and playing when asked', () => {
    const frame = run('?v=j7ULT6dznNc&start=42&mute=1').querySelector('iframe');
    expect(frame.src).toBe(
      'https://www.youtube-nocookie.com/embed/j7ULT6dznNc?playsinline=1&rel=0&start=42&mute=1&autoplay=1',
    );
  });

  it.each([
    ['a negative start', '?v=j7ULT6dznNc&start=-5'],
    ['a start with markup', '?v=j7ULT6dznNc&start=%3Cb%3E'],
    ['a start that is too long', '?v=j7ULT6dznNc&start=123456'],
    ['a mute that is not 1', '?v=j7ULT6dznNc&mute=true'],
  ])('ignores %s and still frames the video', (_label, search) => {
    const frame = run(search).querySelector('iframe');
    expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/j7ULT6dznNc?playsinline=1&rel=0');
  });

  it.each([
    ['no id', ''],
    ['a URL', '?v=https%3A%2F%2Fevil.example%2F'],
    ['markup', '?v=%3Cimg%20src%3Dx%3E'],
    ['an id with a path', '?v=j7ULT6dznNc%2F..%2Fx'],
    ['a short id', '?v=abc'],
  ])('refuses %s and frames nothing', (_label, search) => {
    const body = run(search);
    expect(body.querySelector('iframe')).toBeNull();
    expect(body.textContent).toBe('This video link is not valid.');
  });
});
