import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PlanBadge from './PlanBadge';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderBadge() {
  return render(
    <MemoryRouter>
      <PlanBadge />
    </MemoryRouter>,
  );
}

function withAccount(account) {
  useAuth.mockReturnValue({ account });
}

describe('PlanBadge', () => {
  it('offers Go Pro on a Free household, linking to the billing screen', () => {
    withAccount({ id: 1, plan: 'FREE' });
    renderBadge();

    const link = screen.getByRole('link', { name: 'Go Pro' });
    expect(link).toHaveAttribute('href', '/app/billing');
  });

  it('shows a static Pro badge on a Pro household', () => {
    withAccount({ id: 1, plan: 'PRO' });
    renderBadge();

    // exact:true throughout -- "Pro" is a substring of "Profile", which is UserMenu's first item
    // and lives in this same header subtree. A loose match would collide with it.
    expect(screen.getByText('Pro', { exact: true })).toBeInTheDocument();
  });

  it('does not make the Pro badge tappable', () => {
    withAccount({ id: 1, plan: 'PRO' });
    renderBadge();

    // Managing a subscription happens through the account menu; a Pro member has nothing to do
    // here, so it must not look or behave like a control.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // THE case this component exists to get right. An auth snapshot written before billing shipped
  // carries no `plan`, so it hydrates as undefined -- and rendering "Go Pro" then would nag a
  // household that already pays. Absence is the only safe answer; it self-corrects on the next /me.
  it('renders nothing at all when the plan is unknown', () => {
    withAccount({ id: 1 });
    const { container } = renderBadge();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Go Pro')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no account yet', () => {
    withAccount(null);
    const { container } = renderBadge();

    expect(container).toBeEmptyDOMElement();
  });

  // A value the client has never seen before (a plan added server-side after this build shipped)
  // must fall into the same silent case rather than being treated as Free.
  it('renders nothing for an unrecognised plan value', () => {
    withAccount({ id: 1, plan: 'ENTERPRISE' });
    const { container } = renderBadge();

    expect(container).toBeEmptyDOMElement();
  });
});
