import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

// A modal whose parent re-renders on every keystroke, passing `onScrim` as an inline arrow --
// i.e. exactly how every caller in this app uses it. The identity of that arrow changes on each
// render, which is what made the focus effect re-run and steal the caret.
function TypingHarness({ onScrim }) {
  const [note, setNote] = useState('');
  return (
    <Modal onScrim={onScrim ? () => onScrim() : () => {}}>
      <input aria-label="tag name" />
      <textarea aria-label="note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

describe('Modal focus management', () => {
  it('moves focus to the first control when it opens', () => {
    render(<TypingHarness />);
    expect(document.activeElement).toBe(screen.getByLabelText('tag name'));
  });

  // The regression this exists for: typing in one field used to yank the caret back to the
  // first control on every keystroke, because `onScrim` was an effect dependency and its
  // identity changed on each parent render. In the real app that showed up as focus jumping
  // between the note box and the tag input in the Customize Exercise modal.
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
    const onScrim = vi.fn();
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && (
            <Modal
              onScrim={() => {
                onScrim();
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
    expect(onScrim).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('locks background scroll while open and releases it on close', () => {
    const { unmount } = render(<TypingHarness />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
