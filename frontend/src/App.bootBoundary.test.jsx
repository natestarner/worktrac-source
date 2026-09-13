import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ⚠️ These two files need a longer bound than vitest's 5000ms default, and it is not arbitrary.
//
// They are the only specs that render the WHOLE App -- every provider, the router, the error
// boundaries -- and they do it several times per file. In isolation each takes well under a
// second; inside the full 1382-test suite, competing for the same machine, they routinely cross
// five seconds and time out. Measured: the full suite fails 3/3 at the default and passes 136/136
// at 20s, with no other change.
//
// That flake predates this line (it is recorded as an intermittent both-ways failure on untouched
// main) and it is a TIMEOUT, never a wrong assertion -- so raising the bound here fixes the
// reporting rather than hiding a defect. It is set per-file instead of globally on purpose: every
// other spec should keep failing fast, and a genuinely hung App render still fails, just after a
// bound that reflects what this particular test actually costs.
//
// The first timeout also CASCADES, which is why one slow test shows up as several failures: a
// timed-out test leaves its DOM mounted, so the next test's query matches both its own elements
// and the leftovers and dies with "Found multiple elements". Don't chase that second error.
vi.setConfig({ testTimeout: 20000 });


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

  // "Try again" alone re-renders the SAME tree against the SAME (still-poisoned) restored state --
  // for a throw rooted in axis D that just throws again immediately. A real link to /login is the
  // PRIMARY way out here, not merely present: see CriticalErrorFallback.jsx's header for the two
  // times this exact "painted, then white, had to manually type the login URL" shape was reported.
  it('offers a real link to /login as the primary way out, not just Try again', async () => {
    await renderApp();

    const login = screen.getByRole('link', { name: 'Go to login' });
    expect(login).toHaveAttribute('href', '/login');
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
