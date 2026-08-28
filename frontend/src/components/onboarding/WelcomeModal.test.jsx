import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WelcomeModal from './WelcomeModal';

function renderModal(overrides = {}) {
  return render(<WelcomeModal onAccept={vi.fn()} onDismiss={vi.fn()} {...overrides} />);
}

describe('WelcomeModal', () => {
  it('titles the dialog "Welcome to Huddle"', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeInTheDocument();
  });

  // "Not now" must read as a postponement, not a one-way door -- the tour is replayable, and this
  // is the one place that says so.
  it('mentions that the tour can be restarted from Help', () => {
    renderModal();
    expect(screen.getByText(/Help/)).toBeInTheDocument();
  });

  it('shows both "Show me around" and "Not now"', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Show me around' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('calls onAccept when "Show me around" is clicked', () => {
    const onAccept = vi.fn();
    renderModal({ onAccept });
    fireEvent.click(screen.getByRole('button', { name: 'Show me around' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when "Not now" is clicked', () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss from the header X too', () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // So a copy change fails here, rather than surfacing as a strict-mode violation in an unrelated
  // Playwright spec that happens to select one of these by substring.
  it('keeps the three control names mutually non-containing', () => {
    const names = ['Show me around', 'Not now', 'Close'];
    for (const a of names) {
      for (const b of names) {
        if (a !== b) expect(b.toLowerCase()).not.toContain(a.toLowerCase());
      }
    }
  });
});
