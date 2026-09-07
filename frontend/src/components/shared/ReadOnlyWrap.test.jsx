import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReadOnlyWrap from './ReadOnlyWrap';
import OfflineDisabledWrap from './OfflineDisabledWrap';

const access = vi.hoisted(() => ({ current: {} }));
const online = vi.hoisted(() => ({ current: true }));

vi.mock('../../hooks/useAccountAccess', () => ({
  useAccountAccess: () => access.current,
}));
vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => online.current,
}));

function asOwner() {
  access.current = { canWritePerson: () => true };
}

function asMemberWhoOwns(personId) {
  access.current = { canWritePerson: (id) => id == null || String(id) === String(personId) };
}

function renderNested(personId) {
  return render(
    <OfflineDisabledWrap message="Editing needs a connection.">
      <ReadOnlyWrap personId={personId}>
        <button>Edit</button>
      </ReadOnlyWrap>
    </OfflineDisabledWrap>,
  );
}

describe('ReadOnlyWrap', () => {
  it('leaves a writable control untouched', () => {
    asOwner();
    online.current = true;
    render(
      <ReadOnlyWrap personId={5}>
        <button>Edit</button>
      </ReadOnlyWrap>,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('disables a control belonging to someone else', () => {
    asMemberWhoOwns(5);
    online.current = true;
    render(
      <ReadOnlyWrap personId={9}>
        <button>Edit</button>
      </ReadOnlyWrap>,
    );
    const button = screen.getByRole('button', { name: 'Edit' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'You can only change your own workouts.');
  });

  // Omitted / null personId means "not person-scoped". Blocking there would disable the app for
  // the frame between mount and person auto-select.
  it('never disables when no person is named', () => {
    asMemberWhoOwns(5);
    online.current = true;
    render(
      <ReadOnlyWrap>
        <button>Add</button>
      </ReadOnlyWrap>,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  // ⚠️ THE PRECEDENCE RULE. A control a member can never use must not claim it "needs a
  // connection" -- that sends someone hunting for signal over something no connection fixes.
  describe('composed with OfflineDisabledWrap', () => {
    it('forwards the offline treatment when the control IS writable', () => {
      asOwner();
      online.current = false;
      renderNested(5);

      const button = screen.getByRole('button', { name: 'Edit' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Editing needs a connection.');
    });

    it('wins over the offline message when the control is NOT writable', () => {
      asMemberWhoOwns(5);
      online.current = false;
      renderNested(9);

      const button = screen.getByRole('button', { name: 'Edit' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'You can only change your own workouts.');
    });

    it('says nothing at all when the control is writable and online', () => {
      asOwner();
      online.current = true;
      renderNested(5);

      const button = screen.getByRole('button', { name: 'Edit' });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('title');
    });
  });
});
