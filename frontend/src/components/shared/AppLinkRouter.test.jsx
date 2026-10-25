import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLinkRouter from './AppLinkRouter';
import { listenForAppLinks } from '../../lib/native';

vi.mock('../../lib/native', () => ({ listenForAppLinks: vi.fn() }));

let goTo;
function Harness() {
  const navigate = useNavigate();
  goTo = navigate;
  return <div data-testid="path">{useLocation().pathname + useLocation().search}</div>;
}

beforeEach(() => {
  listenForAppLinks.mockReset();
  listenForAppLinks.mockReturnValue(() => {});
});

describe('AppLinkRouter', () => {
  // navigate is a new function on every pathname change, and subscribing per identity re-read the
  // launch link on every tab tap -- straight back to the billing screen after an App Store checkout.
  it('subscribes once, however often the route changes', () => {
    render(
      <MemoryRouter initialEntries={['/app/billing']}>
        <AppLinkRouter />
        <Harness />
      </MemoryRouter>,
    );
    act(() => goTo('/app/log'));
    act(() => goTo('/app/history'));

    expect(listenForAppLinks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('path').textContent).toBe('/app/history');
  });

  it('routes a link with the current navigate after the route has moved on', () => {
    render(
      <MemoryRouter initialEntries={['/app/log']}>
        <AppLinkRouter />
        <Harness />
      </MemoryRouter>,
    );
    act(() => goTo('/app/history'));
    const onPath = listenForAppLinks.mock.calls[0][0];
    act(() => onPath('/join?i=5'));

    expect(screen.getByTestId('path').textContent).toBe('/join?i=5');
  });
});
