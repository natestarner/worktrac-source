import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TextArea from './TextArea';

// Mirrors Input.test.jsx: the point of the primitive is that the error affordance is never
// colour-only, so the aria wiring is the thing worth pinning.
describe('TextArea', () => {
  it('renders a plain textarea with no error state by default', () => {
    render(<TextArea id="notes" aria-label="Notes" />);
    const field = screen.getByLabelText('Notes');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field.className).toContain('input');
    expect(field.className).not.toContain('input-invalid');
  });

  it('wires aria-invalid and aria-describedby to the message when given an error', () => {
    render(<TextArea id="notes" aria-label="Notes" error="Tell us more." />);
    const field = screen.getByLabelText('Notes');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'notes-error');
    expect(screen.getByText('Tell us more.')).toHaveAttribute('id', 'notes-error');
  });

  it('draws the invalid border without a message when only `invalid` is set', () => {
    render(<TextArea id="notes" aria-label="Notes" invalid />);
    const field = screen.getByLabelText('Notes');
    expect(field.className).toContain('input-invalid');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).not.toHaveAttribute('aria-describedby');
  });

  // Resizing horizontally can drag the field wider than a phone viewport, which is the one
  // direction there is no way back from one-handed.
  it('allows only vertical resizing', () => {
    render(<TextArea id="notes" aria-label="Notes" />);
    expect(screen.getByLabelText('Notes')).toHaveStyle({ resize: 'vertical' });
  });
});
