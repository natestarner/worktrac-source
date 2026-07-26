import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServiceWorkerUpdater from './ServiceWorkerUpdater';
import { __resetSwUpdateForTests, markUpdateAvailable } from '../../lib/swUpdate';

describe('ServiceWorkerUpdater', () => {
  afterEach(() => {
    __resetSwUpdateForTests();
    vi.restoreAllMocks();
  });

  it('renders nothing until a new version is available', () => {
    render(<ServiceWorkerUpdater />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('prompts once an update is marked available, and reloads via the stashed update function on Reload', () => {
    const updateSW = vi.fn();
    render(<ServiceWorkerUpdater />);

    act(() => markUpdateAvailable(updateSW));
    expect(screen.getByRole('dialog')).toHaveTextContent(/new version is available/i);

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('can be dismissed without reloading (never interrupts a workout)', () => {
    const updateSW = vi.fn();
    render(<ServiceWorkerUpdater />);

    act(() => markUpdateAvailable(updateSW));
    fireEvent.click(screen.getByRole('button', { name: /later/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateSW).not.toHaveBeenCalled();
  });
});
