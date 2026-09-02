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

  it('links the Pro badge to the billing screen too', () => {
    withAccount({ id: 1, plan: 'PRO' });
    renderBadge();

    // exact:true for the same reason as above -- "Pro" is also a substring of "Go Pro"/
    // "Upgrade to Pro", neither of which can ever be on screen at the same time as this (Free and
    // Pro are mutually exclusive).
    const link = screen.getByRole('link', { name: 'Pro', exact: true });
    expect(link).toHaveAttribute('href', '/app/billing');
  });

  // The mark names the product, so it leads BOTH pills -- it is not a reward for paying. This
  // replaced an outline star on the Free badge, which had made the mark mean "you have Pro"; what
  // distinguishes the two states now is the pill's own styling, not the glyph. Asserted as an svg
  // rather than by role, because HuddleMark is aria-hidden by design (it must never touch the
  // "Go Pro"/"Pro" accessible names, which the non-containment rule depends on).
  it('leads both pills with the mark, so Pro reads as Huddle Pro on either plan', () => {
    withAccount({ id: 1, plan: 'FREE' });
    const free = renderBadge();
    expect(free.container.querySelector('.plan-badge--upgrade svg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go Pro' })).toBeInTheDocument();
    free.unmount();

    withAccount({ id: 1, plan: 'PRO' });
    const pro = renderBadge();
    expect(pro.container.querySelector('.plan-badge--pro svg')).toBeInTheDocument();
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
