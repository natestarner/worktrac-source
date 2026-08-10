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
