import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasteCodeButton from './PasteCodeButton';

function withClipboard(readText) {
  Object.defineProperty(navigator, 'clipboard', { value: readText ? { readText } : undefined, configurable: true });
}

afterEach(() => withClipboard(undefined));

describe('PasteCodeButton', () => {
  // Feature-detected: where nothing can read the clipboard, the field is left exactly as it was.
  it('is absent where the clipboard cannot be read', () => {
    withClipboard(undefined);
    render(<PasteCodeButton onCode={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Paste code' })).toBeNull();
  });

  it('pastes the code from what was copied, gap and sentence included', async () => {
    withClipboard(vi.fn().mockResolvedValue('Your code is 482 913'));
    const onCode = vi.fn();
    render(<PasteCodeButton onCode={onCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));
    await waitFor(() => expect(onCode).toHaveBeenCalledWith('482913'));
  });

  it('says so when what was copied is not a code, and changes nothing', async () => {
    withClipboard(vi.fn().mockResolvedValue('hello'));
    const onCode = vi.fn();
    render(<PasteCodeButton onCode={onCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn’t a 6-digit code/);
    expect(onCode).not.toHaveBeenCalled();
  });

  // Refused, or iOS's Paste bubble dismissed: point at the way that always works.
  it('points at touch-and-hold when the clipboard refuses', async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    render(<PasteCodeButton onCode={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Touch and hold the box/);
  });
});
