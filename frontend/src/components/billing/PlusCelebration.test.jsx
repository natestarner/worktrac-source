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

  // ⚠️ The tier, and what that tier just unlocked. This said "Welcome to Huddle Plus" under a line
  // about history, records and import -- so a trainer finishing a Pro checkout was congratulated on
  // four things they already had and none of the four they had paid for.
  it('welcomes a Pro checkout to Pro, and names what Pro unlocked', () => {
    render(<PlusCelebration plan="PRO" onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Pro')).toBeInTheDocument();
    expect(screen.getByText(/clients get their own logins/)).toBeInTheDocument();
    expect(screen.queryByText(/import are unlocked/)).not.toBeInTheDocument();
  });

  it('welcomes a Plus checkout to Plus', () => {
    render(<PlusCelebration plan="PLUS" onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
    expect(screen.getByText(/import are unlocked/)).toBeInTheDocument();
  });

  // ⚠️ The OPPOSITE call from PlanBadge's, deliberately. The badge renders nothing for a tier it
  // does not recognise, because it is permanent chrome that self-corrects on the next /me. This is
  // a one-shot congratulation over a payment that has already succeeded, and showing nothing after
  // a successful checkout reads as "did that work?".
  it('still celebrates a tier this build has never heard of', () => {
    render(<PlusCelebration plan="ENTERPRISE" onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
  });
});
