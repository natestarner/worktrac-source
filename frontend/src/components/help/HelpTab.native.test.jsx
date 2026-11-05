import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HelpTab from './HelpTab';
import { useUI } from '../../context/UIContext';

// The install section is the one place the handbook's words depend on where it is read: the web
// tells you how to put Huddle on your home screen; inside the App Store app that is already done.
const native = vi.hoisted(() => ({ on: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
    getPlatform: () => (native.on ? 'ios' : 'web'),
  },
}));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
// /me's client config, as the auth snapshot holds it. appStoreUrl is '' until a listing exists.
const auth = vi.hoisted(() => ({ client: null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
const LISTING = 'https://apps.apple.com/us/app/huddle-workout-tracker/id6826555272';

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpTab />
    </MemoryRouter>
  );
}

beforeEach(() => {
  native.on = false;
  auth.client = null;
  useUI.mockReturnValue({ startTour: vi.fn() });
});

describe('HelpTab install section', () => {
  it('on the web with a listing, links to the App Store and still explains Add to Home Screen', () => {
    auth.client = { minSupportedNativeBuild: 0, appStoreUrl: LISTING };
    renderHelp();
    expect(screen.getByRole('heading', { name: 'Put it on your phone' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Huddle from the App Store' });
    expect(link).toHaveAttribute('href', LISTING);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/On any other phone or tablet, open/)).toBeInTheDocument();
    expect(screen.queryByText(/no app store/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /using the Huddle app/ })).not.toBeInTheDocument();
  });

  it('on the web with no listing configured, offers only Add to Home Screen', () => {
    for (const client of [null, { minSupportedNativeBuild: 0, appStoreUrl: '' }]) {
      auth.client = client;
      const { unmount } = renderHelp();
      expect(screen.getByRole('heading', { name: 'Put it on your phone' })).toBeInTheDocument();
      expect(screen.getByText(/in your browser and from your browser's settings/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /App Store/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/On any other phone/)).not.toBeInTheDocument();
      // The sentence this replaced: false since the app went on sale (2026-11-05).
      expect(screen.queryByText(/no app store/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('inside the app, says it is already installed instead of telling you to install it', () => {
    native.on = true;
    auth.client = { minSupportedNativeBuild: 0, appStoreUrl: LISTING };
    renderHelp();
    expect(screen.getByRole('heading', { name: 'You’re using the Huddle app' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /App Store/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Put it on your phone' })).not.toBeInTheDocument();
  });

  it('mentions the lock-screen rest nudge and the stay-awake screen only inside the app', () => {
    renderHelp();
    expect(screen.queryByText(/your phone tells you when the bar fills/)).not.toBeInTheDocument();
  });

  it('describes them inside the app', () => {
    native.on = true;
    renderHelp();
    expect(screen.getByText(/your phone tells you when the bar fills/)).toBeInTheDocument();
  });
});
