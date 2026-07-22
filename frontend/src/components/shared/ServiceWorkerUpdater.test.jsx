import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServiceWorkerUpdater from './ServiceWorkerUpdater';

describe('ServiceWorkerUpdater', () => {
  afterEach(() => {
    delete window.__pwaUpdateSW;
    vi.restoreAllMocks();
  });

  it('renders nothing until a new version is waiting', () => {
    render(<ServiceWorkerUpdater />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('prompts on pwa:needrefresh and reloads via the stashed update function on Reload', () => {
    const updateSW = vi.fn();
    window.__pwaUpdateSW = updateSW;
    render(<ServiceWorkerUpdater />);

    act(() => window.dispatchEvent(new Event('pwa:needrefresh')));
    expect(screen.getByRole('dialog')).toHaveTextContent(/new version is available/i);

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('can be dismissed without reloading (never interrupts a workout)', () => {
    const updateSW = vi.fn();
    window.__pwaUpdateSW = updateSW;
    render(<ServiceWorkerUpdater />);

    act(() => window.dispatchEvent(new Event('pwa:needrefresh')));
    fireEvent.click(screen.getByRole('button', { name: /later/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateSW).not.toHaveBeenCalled();
  });
});
