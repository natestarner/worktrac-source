import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One switch for "are we inside the app", flipped per test. Every adapter reads it through
// platform.js, so mocking @capacitor/core is the whole seam -- the adapters themselves run for real.
const native = vi.hoisted(() => ({ on: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
    getPlatform: () => (native.on ? 'ios' : 'web'),
  },
}));

const plugins = vi.hoisted(() => ({
  writeFile: vi.fn(),
  share: vi.fn(),
  browserOpen: vi.fn(),
  notification: vi.fn(),
  impact: vi.fn(),
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: plugins.writeFile },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: plugins.browserOpen } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { notification: plugins.notification, impact: plugins.impact },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS' },
}));

import { saveFile, openExternal, externalLinkProps, nativeHaptic, isInstalledApp } from './index';

beforeEach(() => {
  native.on = false;
  Object.values(plugins).forEach((fn) => fn.mockReset());
  plugins.writeFile.mockResolvedValue({ uri: 'file:///cache/workout-data.csv' });
  plugins.share.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveFile', () => {
  it('on the web, downloads through an anchor exactly as export always did, and touches no plugin', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await saveFile(new Blob(['a,b']), 'workout-data.csv');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0];
    expect(anchor.download).toBe('workout-data.csv');
    expect(anchor.href).toBe('blob:x');
    expect(plugins.writeFile).not.toHaveBeenCalled();
    expect(plugins.share).not.toHaveBeenCalled();
  });

  it('in the app, writes the file to the cache and offers it through the share sheet', async () => {
    native.on = true;

    await saveFile(new Blob(['a,b']), 'workout-data.csv');

    expect(plugins.writeFile).toHaveBeenCalledWith({
      path: 'workout-data.csv',
      data: btoa('a,b'),
      directory: 'CACHE',
    });
    expect(plugins.share).toHaveBeenCalledWith({
      title: 'workout-data.csv',
      files: ['file:///cache/workout-data.csv'],
    });
  });

  // Closing the share sheet is the person changing their mind. Reaching the caller would show
  // "Couldn't export" over an export that worked.
  it('treats a dismissed share sheet as done, not as a failed export', async () => {
    native.on = true;
    plugins.share.mockRejectedValue(new Error('Share canceled'));

    await expect(saveFile(new Blob(['x']), 'f.csv')).resolves.toBeUndefined();
  });

  it('still reports a real failure', async () => {
    native.on = true;
    plugins.writeFile.mockRejectedValue(new Error('disk full'));

    await expect(saveFile(new Blob(['x']), 'f.csv')).rejects.toThrow('disk full');
  });
});

describe('external links', () => {
  it('on the web, is the same new-tab anchor as before, with no click handler at all', () => {
    expect(externalLinkProps('https://huddle.fitness/terms.html')).toEqual({
      href: 'https://huddle.fitness/terms.html',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('on the web, openExternal opens a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openExternal('https://huddle.fitness/privacy.html');
    expect(open).toHaveBeenCalledWith('https://huddle.fitness/privacy.html', '_blank', 'noopener,noreferrer');
    expect(plugins.browserOpen).not.toHaveBeenCalled();
  });

  it('in the app, takes over the click and opens the in-app browser instead of leaving for Safari', async () => {
    native.on = true;
    const props = externalLinkProps('https://huddle.fitness/terms.html');
    const event = { preventDefault: vi.fn() };

    props.onClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(plugins.browserOpen).toHaveBeenCalledWith({ url: 'https://huddle.fitness/terms.html' })
    );
  });
});

describe('nativeHaptic', () => {
  it('declines on the web, so lib/haptics.js takes its existing routes', () => {
    expect(nativeHaptic('celebrate')).toBe(false);
    expect(plugins.notification).not.toHaveBeenCalled();
  });

  it('in the app, plays the success pattern for a record and a light tap for finishing', async () => {
    native.on = true;

    expect(nativeHaptic('celebrate')).toBe(true);
    await vi.waitFor(() => expect(plugins.notification).toHaveBeenCalledWith({ type: 'SUCCESS' }));

    expect(nativeHaptic('complete')).toBe(true);
    await vi.waitFor(() => expect(plugins.impact).toHaveBeenCalledWith({ style: 'LIGHT' }));
  });

  it('never throws when the haptic engine fails -- it is decoration', async () => {
    native.on = true;
    plugins.impact.mockRejectedValue(new Error('no engine'));
    expect(() => nativeHaptic('complete')).not.toThrow();
    await vi.waitFor(() => expect(plugins.impact).toHaveBeenCalled());
  });
});

describe('isInstalledApp', () => {
  it('is true inside the App Store app, which is not in display-mode: standalone', () => {
    native.on = true;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(isInstalledApp()).toBe(true);
  });
});
