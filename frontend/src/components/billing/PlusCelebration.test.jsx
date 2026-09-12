import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlusCelebration from './PlusCelebration';

describe('PlusCelebration', () => {
  it('shows the welcome message', () => {
    render(<PlusCelebration onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
  });

  // Deliberately not a Modal -- same exception as PRCelebration (frontend-core.md): a transient
  // celebration dismissed by tapping anywhere, not a dialog with a job to finish.
  it('dismisses on a scrim tap', () => {
    const onDismiss = vi.fn();
    render(<PlusCelebration onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Welcome to Huddle Plus'));

    expect(onDismiss).toHaveBeenCalled();
  });
});
