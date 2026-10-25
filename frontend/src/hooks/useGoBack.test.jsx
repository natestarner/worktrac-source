import { act, render, screen } from '@testing-library/react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGoBack } from './useGoBack';

// A real <BrowserRouter>, because what the hook reads is the index BrowserRouter writes into
// window.history.state -- MemoryRouter never touches window.history at all.
let goTo;
let goBack;
function Harness() {
  goTo = useNavigate();
  goBack = useGoBack();
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderAt(path) {
  window.history.replaceState(null, '', path);
  return render(
    <BrowserRouter>
      <Harness />
    </BrowserRouter>,
  );
}

const path = () => screen.getByTestId('path').textContent;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useGoBack', () => {
  // The App Store app reopening on the screen it was killed on, or a deep link in a fresh tab:
  // nothing behind this screen, so navigate(-1) did nothing at all.
  it('goes to Log when this screen is the first thing in history', () => {
    renderAt('/app/profile');

    act(() => goBack());

    expect(path()).toBe('/app/log');
  });

  it('goes back when there is somewhere to go back to', async () => {
    renderAt('/app/history');
    act(() => goTo('/app/profile'));
    expect(path()).toBe('/app/profile');

    // history.back() is asynchronous in jsdom too: React Router hears it as a popstate.
    await act(async () => {
      goBack();
      await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });

    expect(path()).toBe('/app/history');
  });
});
