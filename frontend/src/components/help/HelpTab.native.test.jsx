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

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpTab />
    </MemoryRouter>
  );
}

beforeEach(() => {
  native.on = false;
  useUI.mockReturnValue({ startTour: vi.fn() });
});

describe('HelpTab install section', () => {
  it('on the web, still explains Add to Home Screen, word for word as before', () => {
    renderHelp();
    expect(screen.getByRole('heading', { name: 'Put it on your home screen' })).toBeInTheDocument();
    expect(screen.getByText(/Huddle is a website, so there is no app store\./)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /using the Huddle app/ })).not.toBeInTheDocument();
  });

  it('inside the app, says it is already installed instead of telling you to install it', () => {
    native.on = true;
    renderHelp();
    expect(screen.getByRole('heading', { name: 'You’re using the Huddle app' })).toBeInTheDocument();
    expect(screen.queryByText(/there is no app store/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Put it on your home screen' })).not.toBeInTheDocument();
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
