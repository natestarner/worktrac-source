import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

// A modal whose parent re-renders on every keystroke, passing `onClose` as an inline arrow --
// i.e. exactly how every caller in this app uses it. The identity of that arrow changes on each
// render, which is what made the focus effect re-run and steal the caret.
function TypingHarness({ onClose }) {
  const [note, setNote] = useState('');
  return (
    <Modal onClose={onClose ? () => onClose() : () => {}}>
      <input aria-label="tag name" />
      <textarea aria-label="note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

describe('Modal focus management', () => {
  it('moves focus to the first control when it opens, skipping the header X', () => {
    // The X is first in DOM order. Focus belongs to the first real control -- the name field,
    // note box or stepper the person actually came here to use.
    render(<TypingHarness />);
    expect(document.activeElement).toBe(screen.getByLabelText('tag name'));
  });

  // initialFocus="dialog" exists for a modal whose first control is a SEGMENTED input. Focusing an
  // <input type="date"> makes the browser highlight its active segment, so "Log a past workout"
  // opened with a stray selected number in the date field -- it read as a rendering fault.
  //
  // jsdom renders no segment highlight, so what is asserted here is the thing that CAUSES it:
  // which element holds focus. The visual symptom is downstream of exactly that.
  it('lands on the dialog itself when initialFocus is "dialog", not the first field', () => {
    render(
      <Modal onClose={() => {}} title="Log a past workout" initialFocus="dialog">
        <input aria-label="date" type="date" />
        <input aria-label="time" type="time" />
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(screen.getByLabelText('date'));
  });

  // The default must not change: every other modal wants a real field, and landing on the dialog
  // everywhere would be a worse keyboard experience, not a safer one.
  it('still prefers the first control when initialFocus is not given', () => {
    render(
      <Modal onClose={() => {}} title="Anything else">
        <input aria-label="date" type="date" />
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByLabelText('date'));
  });

  // Tab must still reach the fields -- focusing the container is only acceptable because nothing
  // is removed from the tab cycle. A dialog that trapped focus on itself would be a real downgrade.
  it('keeps every control reachable after landing on the dialog', () => {
    render(
      <Modal onClose={() => {}} title="Log a past workout" initialFocus="dialog">
        <input aria-label="date" type="date" />
        <input aria-label="time" type="time" />
      </Modal>,
    );

    const date = screen.getByLabelText('date');
    date.focus();
    expect(document.activeElement).toBe(date);
  });

  // The regression this exists for: typing in one field used to yank the caret back to the
  // first control on every keystroke, because the dismissal callback was an effect dependency
  // and its identity changed on each parent render. In the real app that showed up as focus
  // jumping between the note box and the tag input in the Customize Exercise modal.
  it('does not steal focus back on re-render while the user is typing', () => {
    render(<TypingHarness />);
    const note = screen.getByLabelText('note');

    note.focus();
    fireEvent.change(note, { target: { value: 'Keep elbows' } });
    expect(document.activeElement).toBe(note);

    fireEvent.change(note, { target: { value: 'Keep elbows tucked' } });
    expect(document.activeElement).toBe(note);
    expect(note.value).toBe('Keep elbows tucked');
  });

  it('closes on Escape and restores focus to whatever opened it', () => {
    const onClose = vi.fn();
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && (
            <Modal
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <input aria-label="tag name" />
            </Modal>
          )}
        </>
      );
    }
    render(<Opener />);
    const trigger = screen.getByRole('button', { name: 'open' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByLabelText('tag name'));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('locks background scroll while open and releases it on close', () => {
    const { unmount } = render(<TypingHarness />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Modal dismissal', () => {
  // The reason the whole backdrop handler is gone: this app is used one-handed on an iPad
  // mid-set, and a stray thumb on the scrim used to discard a half-built routine or an unsaved
  // note with no confirmation and no undo. Closing is always deliberate now.
  it('does NOT close when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<TypingHarness onClose={onClose} />);

    // The scrim is the dialog's parent -- the only thing between it and the portal root.
    const scrim = screen.getByRole('dialog').parentElement;
    fireEvent.click(scrim);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the header X', () => {
    const onClose = vi.fn();
    render(<TypingHarness onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The content wrapper's top padding does double duty: with a header it is the gap below the
  // title, and with no header it is the panel's own top inset. Those want different numbers -- the
  // gap was 36px of padding (~40px measured from the title's box to the first field in every modal)
  // and read as detached, while a headerless panel still wants a full space-6 all round.
  //
  // Pinned because getting it wrong is silent: an unconditional space-4 leaves a headerless modal
  // with 16px on top against 24px on its other three sides, which no test would otherwise notice.
  // jsdom computes no layout, but this is an inline style, so the declaration itself is readable.
  // Read off the `padding` SHORTHAND rather than `style.paddingTop`: jsdom does not expand a
  // shorthand whose values contain var(), so the longhand reads back as ''. The first component of
  // the shorthand is the top edge.
  const topPadding = (el) => el.style.padding.split(' ')[0];

  it('tightens the top inset only when there is a header above it', () => {
    const { unmount } = render(
      <Modal title="Add a person" onClose={() => {}}>
        <input aria-label="name" />
      </Modal>,
    );
    expect(topPadding(screen.getByRole('dialog').lastElementChild)).toBe('var(--space-4)');
    unmount();

    render(
      <Modal>
        <input aria-label="name" />
      </Modal>,
    );
    expect(topPadding(screen.getByRole('dialog').lastElementChild)).toBe('var(--space-6)');
  });

  // The 2026-08-10 incident's structural rule, which this must not undo: the header is
  // position:sticky WITH a z-index, so it paints above ordinary flow content regardless of DOM
  // order and can rasterize a hairline over anything it merely touches. Most of the gap therefore
  // has to live on the plain, non-positioned wrapper -- shrinking the wrapper instead of the
  // header's padding would quietly re-open that bug.
  it('keeps most of the header gap on the non-positioned wrapper, not the sticky header', () => {
    render(
      <Modal title="Add a person" onClose={() => {}}>
        <input aria-label="name" />
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const header = dialog.firstElementChild;
    const content = dialog.lastElementChild;

    // The header is the elevated one; the wrapper must stay plain flow content.
    expect(header.style.position).toBe('sticky');
    expect(content.style.position).toBe('');

    // Compare the SHARES, not the literals -- the claim is "the wrapper owns more of the gap than
    // the sticky header does", which stays true (and stays checkable) if both numbers are retuned
    // later. --space-N is monotonic in N, so the step index orders them. Third component of the
    // padding shorthand is the bottom edge.
    const step = (token) => Number(token.match(/--space-(\d+)/)[1]);
    expect(step(topPadding(content))).toBeGreaterThan(step(header.style.padding.split(' ')[2]));
  });

  it('renders no header at all when neither a title nor onClose is given', () => {
    render(
      <Modal>
        <input aria-label="tag name" />
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('labels the dialog from its title', () => {
    render(
      <Modal title="Edit routine" onClose={vi.fn()}>
        <input aria-label="tag name" />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Edit routine' })).toBeInTheDocument();
  });
});
