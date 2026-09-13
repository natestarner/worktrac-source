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


// The "last-resort" boundary around <Routes> in App.jsx -- distinct from the outermost boot
// boundary (App.bootBoundary.test.jsx) and from AppShell's tab-panel boundary. It catches a throw
// in a route itself, or (its bigger surface, per its own comment in App.jsx) in AppShell's chrome
// -- Header, PersonPillBar, SessionBar, and AppShell's own effects -- none of which sit inside the
// tab-panel boundary, only <Outlet/> does.
//
// LoginPage is the simplest real route to throw from for this test: unlike anything behind
// ProtectedRoute, it needs no authenticated boot sequence to reach.
vi.mock('./routes/LoginPage', () => ({
  default: () => {
    throw new Error('simulated throw in an unauthenticated route');
  },
}));

async function renderAppAt(path) {
  const { default: App } = await import('./App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App route boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains a throw in a route with its own fallback, distinct from the boot boundary', async () => {
    const { container } = await renderAppAt('/login');

    expect(container.innerHTML).not.toBe('');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Its own title -- proves THIS boundary caught it, not the outer boot boundary falling back to
    // catching everything indiscriminately (which would also pass a weaker assertion here).
    expect(screen.getByText('Huddle ran into a problem')).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t finish starting up/i)).not.toBeInTheDocument();
  });

  it('offers the same real link to /login as the boot boundary', async () => {
    await renderAppAt('/login');

    const login = screen.getByRole('link', { name: 'Go to login' });
    expect(login).toHaveAttribute('href', '/login');
  });
});
