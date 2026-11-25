import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlusCelebration from './PlusCelebration';
import { PLUS_BENEFITS, PRO_ADDITIONS } from './planCopy';

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
    for (const { label } of PRO_ADDITIONS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(PLUS_BENEFITS[0].label)).not.toBeInTheDocument();
  });

  // TestFlight 1.4 (2026-11-25): the welcome named three unlocks in a sentence. It now lists every
  // one, the same lines the billing screen sold Plus with (history, records, import, personal
  // logins, Trusted logins).
  it('welcomes a Plus checkout to Plus, listing everything Plus unlocked', () => {
    render(<PlusCelebration plan="PLUS" onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(PLUS_BENEFITS.map((b) => b.label));
    expect(items).toHaveLength(5);
  });

  // ⚠️ The OPPOSITE call from PlanBadge's, deliberately. The badge renders nothing for a tier it
  // does not recognise, because it is permanent chrome that self-corrects on the next /me. This is
  // a one-shot congratulation over a payment that has already succeeded, and showing nothing after
  // a successful checkout reads as "did that work?".
  it('still celebrates a tier this build has never heard of', () => {
    render(<PlusCelebration plan="ENTERPRISE" onDismiss={vi.fn()} />);

    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
  });

  // ⚠️ THE CASE THE FIRST FIX MISSED, and the one e2e caught. `planCopy('FREE')` returns a real
  // entry whose `welcome` is null, so a fallback keyed on "did planCopy return something" sailed
  // past it and rendered "Welcome to Huddle Free" above an empty line. FREE is reachable here for
  // a real window: the auth snapshot still says FREE between a checkout landing and /me catching
  // up, and stays FREE indefinitely when the webhook rather than the reconcile applies the
  // purchase. Nobody celebrates arriving at Free.
  it('never congratulates somebody on reaching Free', () => {
    render(<PlusCelebration plan="FREE" onDismiss={vi.fn()} />);

    expect(screen.queryByText('Welcome to Huddle Free')).not.toBeInTheDocument();
    expect(screen.getByText('Welcome to Huddle Plus')).toBeInTheDocument();
    expect(screen.getByText(PLUS_BENEFITS[0].label)).toBeInTheDocument();
  });
});
