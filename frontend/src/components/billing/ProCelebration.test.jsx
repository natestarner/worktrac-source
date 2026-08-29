import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProCelebration from './ProCelebration';

describe('ProCelebration', () => {
  it('shows the welcome message', () => {
    render(<ProCelebration onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Pro')).toBeInTheDocument();
  });

  // Deliberately not a Modal -- same exception as PRCelebration (frontend-core.md): a transient
  // celebration dismissed by tapping anywhere, not a dialog with a job to finish.
  it('dismisses on a scrim tap', () => {
    const onDismiss = vi.fn();
    render(<ProCelebration onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Welcome to Huddle Pro'));

    expect(onDismiss).toHaveBeenCalled();
  });
});
