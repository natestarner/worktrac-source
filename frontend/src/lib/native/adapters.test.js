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
  launcherOpen: vi.fn(),
  notification: vi.fn(),
  impact: vi.fn(),
  keepAwake: vi.fn(),
  allowSleep: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: { keepAwake: plugins.keepAwake, allowSleep: plugins.allowSleep },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: plugins.checkPermissions,
    requestPermissions: plugins.requestPermissions,
    schedule: plugins.schedule,
    getPending: plugins.getPending,
    cancel: plugins.cancel,
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: plugins.writeFile },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: plugins.browserOpen } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: plugins.launcherOpen } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { notification: plugins.notification, impact: plugins.impact },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS' },
}));

import {
  saveFile,
  openExternal,
  openInBrowser,
  externalLinkProps,
  nativeHaptic,
  isInstalledApp,
  keepScreenAwake,
  allowScreenSleep,
  scheduleRestNotifications,
  cancelRestNotifications,
} from './index';

beforeEach(() => {
  native.on = false;
  Object.values(plugins).forEach((fn) => fn.mockReset());
  plugins.writeFile.mockResolvedValue({ uri: 'file:///cache/workout-data.csv' });
  plugins.share.mockResolvedValue(undefined);
  plugins.getPending.mockResolvedValue({ notifications: [] });
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

  it('on the web, openInBrowser is the same new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openInBrowser('https://checkout.stripe.com/c/pay/cs_1');
    expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1', '_blank', 'noopener,noreferrer');
    expect(plugins.launcherOpen).not.toHaveBeenCalled();
  });

  // Leaving the app is the point: only that makes coming back a visibilitychange.
  it('in the app, openInBrowser leaves for Safari rather than the in-app sheet', async () => {
    native.on = true;
    await openInBrowser('https://checkout.stripe.com/c/pay/cs_1');
    expect(plugins.launcherOpen).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/c/pay/cs_1' });
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

describe('keep the screen awake', () => {
  it('does nothing on the web', async () => {
    await keepScreenAwake();
    await allowScreenSleep();
    expect(plugins.keepAwake).not.toHaveBeenCalled();
    expect(plugins.allowSleep).not.toHaveBeenCalled();
  });

  it('holds and releases the screen in the app, and never throws if the plugin does', async () => {
    native.on = true;
    await keepScreenAwake();
    await allowScreenSleep();
    expect(plugins.keepAwake).toHaveBeenCalledTimes(1);
    expect(plugins.allowSleep).toHaveBeenCalledTimes(1);

    plugins.keepAwake.mockRejectedValue(new Error('nope'));
    await expect(keepScreenAwake()).resolves.toBeUndefined();
  });
});

describe('rest notifications', () => {
  const at = new Date('2026-10-21T12:01:30Z');

  it('schedule nothing on the web', async () => {
    await scheduleRestNotifications([{ personId: 1, at, name: 'Nate' }]);
    await cancelRestNotifications();
    expect(plugins.schedule).not.toHaveBeenCalled();
    expect(plugins.getPending).not.toHaveBeenCalled();
  });

  it('in the app, replace any pending rest nudge with one per person, named', async () => {
    native.on = true;
    plugins.getPending.mockResolvedValue({
      notifications: [
        { id: 700000001, extra: { kind: 'rest' } },
        { id: 42, extra: { kind: 'something-else' } },
      ],
    });

    await scheduleRestNotifications([{ personId: 1, at, name: 'Nate' }]);

    // Only OUR earlier nudge is cancelled; anything else the app ever schedules is left alone.
    expect(plugins.cancel).toHaveBeenCalledWith({ notifications: [{ id: 700000001 }] });
    const [{ notifications }] = plugins.schedule.mock.calls[0];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: 'Rest’s up',
      body: 'Nate, time for your next set.',
      schedule: { at },
      extra: { kind: 'rest', personId: 1 },
    });
  });

  it('cancel only rest nudges when the app comes back', async () => {
    native.on = true;
    plugins.getPending.mockResolvedValue({ notifications: [{ id: 700000002, extra: { kind: 'rest' } }] });
    await cancelRestNotifications();
    expect(plugins.cancel).toHaveBeenCalledWith({ notifications: [{ id: 700000002 }] });
  });

  it('never throws when the device refuses', async () => {
    native.on = true;
    plugins.schedule.mockRejectedValue(new Error('not permitted'));
    await expect(scheduleRestNotifications([{ personId: 1, at, name: null }])).resolves.toBeUndefined();
  });
});
