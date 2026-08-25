import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A throw while AuthProvider / AppStateProvider / UIProvider restore persisted state used to blank
// the screen: both existing boundaries (App's around <Routes>, AppShell's around the tab panel) sit
// INSIDE those providers, so nothing was above them to catch it. It presented as "the app paints,
// then goes white" -- the shell renders, hydration throws a beat later, React unmounts everything.
//
// This pins the boot boundary that closes that gap. The provider is mocked to throw on render,
// which is the shape of the real failure (axis D in .claude/rules/resilience.md: a persisted slice
// or cache entry from an earlier build hydrating into an unexpected value).
vi.mock('./context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    AuthProvider: () => {
      throw new Error('simulated hydration failure while restoring persisted state');
    },
  };
});

// main.jsx owns the real router; App is rendered under one, so supply a MemoryRouter here.
async function renderApp() {
  const { default: App } = await import('./App');
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

describe('App boot boundary', () => {
  beforeEach(() => {
    // getDerivedStateFromError still lets React log the error; keep the run readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains a provider throw instead of blanking the screen', async () => {
    const { container } = await renderApp();

    // The actual regression: an empty root. Assert the DOM is not blank, not merely that some
    // text exists -- a white screen is precisely "container rendered nothing".
    expect(container.innerHTML).not.toBe('');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t finish starting up/i)).toBeInTheDocument();
  });

  it('reassures that queued work is not lost, and offers a way out', async () => {
    await renderApp();

    // Mid-workout on an iPad this is the only thing on screen, so it has to answer the question
    // the person actually has: did I just lose the sets I logged?
    expect(screen.getByText(/still saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('records the error locally, so Contact Us can offer it after recovery', async () => {
    await renderApp();

    // The diagnostic payoff: a boot throw previously reached us in no form whatsoever. This is
    // what makes the NEXT occurrence reportable instead of a shrug.
    const stored = window.localStorage.getItem('worktrac-last-client-error');
    expect(stored).toBeTruthy();
    expect(stored).toContain('simulated hydration failure');
  });
});
