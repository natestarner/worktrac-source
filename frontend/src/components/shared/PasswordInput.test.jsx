import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PasswordInput from './PasswordInput';

function field(props = {}) {
  render(
    <>
      <label htmlFor="pw">Password</label>
      <PasswordInput id="pw" defaultValue="hunter2" {...props} />
    </>,
  );
  return screen.getByLabelText('Password');
}

describe('PasswordInput', () => {
  it('starts hidden and toggles between shown and hidden, keeping what was typed', () => {
    const input = field();
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('hunter2');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('hunter2');
  });

  // On a phone, moving focus to the eye would close the keyboard mid-password.
  it('keeps focus in the field when the eye is pressed', () => {
    field();
    const pressed = fireEvent.mouseDown(screen.getByRole('button', { name: 'Show password' }));
    expect(pressed).toBe(false); // default prevented, so the field keeps focus
  });

  // Revealed as text, iOS would capitalise the first letter and autocorrect the rest.
  it('never auto-capitalises, autocorrects or spell-checks, shown or hidden', () => {
    const input = field();
    for (let i = 0; i < 2; i += 1) {
      expect(input).toHaveAttribute('autocapitalize', 'none');
      expect(input).toHaveAttribute('autocorrect', 'off');
      expect(input).toHaveAttribute('spellcheck', 'false');
      fireEvent.click(screen.getByRole('button', { name: /password/ }));
    }
  });

  it('keeps the id, name and autocomplete that labels, AutoFill and tests rely on', () => {
    const input = field({ name: 'password', autoComplete: 'current-password' });
    expect(input).toHaveAttribute('id', 'pw');
    expect(input).toHaveAttribute('name', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
  });

  it("shows an error under the field, wired to it, like Input's", () => {
    const input = field({ error: 'Use at least 8 characters.' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use at least 8 characters.');
  });

  // A margin on the field would make the wrapper taller than the field and the eye off-centre.
  it("moves a caller's margins to the wrapper and leaves room on the right for the eye", () => {
    const input = field({ style: { marginBottom: 12, padding: 14 } });
    expect(input.style.marginBottom).toBe('');
    expect(input.style.paddingTop).toBe('14px');
    expect(input.style.paddingRight).toBe('calc(40px + var(--space-2))');
    expect(input.parentElement.style.marginBottom).toBe('12px');
  });
});
