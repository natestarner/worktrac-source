import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RefreshIndicator, { REFRESH_INDICATOR_SLOT_ID } from './RefreshIndicator';

// Stands in for the slot AppShell renders inside the sticky chrome. Appended to document.body so
// it is already in the DOM when the component's mount effect looks it up -- the same order the
// real shell produces, where the whole tree is committed before any effect runs.
function mountSlot() {
  const slot = document.createElement('div');
  slot.id = REFRESH_INDICATOR_SLOT_ID;
  document.body.appendChild(slot);
  return slot;
}

afterEach(() => {
  document.getElementById(REFRESH_INDICATOR_SLOT_ID)?.remove();
});

describe('RefreshIndicator', () => {
  it('announces a background refresh so an on-screen value never changes unannounced', () => {
    mountSlot();
    render(<RefreshIndicator show />);
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');
  });

  it('says nothing when there is no background refresh', () => {
    mountSlot();
    render(<RefreshIndicator show={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  // The whole point of the change: the indicator must not be able to move the content it is
  // reporting on. It used to be an in-flow pill, so every 60s refetch pushed the tab down ~35px
  // and pulled it back. Nothing it renders may live in the caller's own flow.
  it('adds nothing to the calling tab except a zero-sized live region', () => {
    mountSlot();
    const { container, rerender } = render(<RefreshIndicator show={false} />);
    const idle = container.innerHTML;

    rerender(<RefreshIndicator show />);

    // Same single .sr-only node in the tab's tree, refreshing or not -- only its text differs.
    expect(container.querySelectorAll(':scope > *')).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass('sr-only');
    expect(container.innerHTML).not.toBe(idle);
  });

  it('puts the visible bar in the shell slot, not in the tab', () => {
    const slot = mountSlot();
    const { container } = render(<RefreshIndicator show />);

    expect(slot.querySelector('.refresh-indicator-bar')).toBeInTheDocument();
    expect(container.querySelector('.refresh-indicator-bar')).toBeNull();
  });

  it('removes the bar from the slot once the refresh lands', () => {
    const slot = mountSlot();
    const { rerender } = render(<RefreshIndicator show />);

    rerender(<RefreshIndicator show={false} />);

    expect(slot.querySelector('.refresh-indicator-bar')).toBeNull();
  });

  // A tab rendered outside the shell (every tab's own unit test does this) has no slot to portal
  // into. That must degrade to "no bar", not to a crash or a stray bar loose in the tab.
  it('still announces, and renders no bar, when no shell slot exists', () => {
    const { container } = render(<RefreshIndicator show />);

    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');
    expect(container.querySelector('.refresh-indicator-bar')).toBeNull();
    expect(document.querySelector('.refresh-indicator-bar')).toBeNull();
  });
});
