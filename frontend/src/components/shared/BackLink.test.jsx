import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BackLink, { ForwardLink } from './BackLink';

describe('BackLink', () => {
  it('renders its text as the accessible name and calls onClick', () => {
    const onClick = vi.fn();
    render(<BackLink onClick={onClick}>&larr; Back</BackLink>);

    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(onClick).toHaveBeenCalled();
  });

  // Every back link shares the one .nav-link recipe (index.css), which is what gives them one size,
  // a 40px target and one gap below.
  it('draws with the shared recipe, in a row that owns the gap below it', () => {
    render(<BackLink onClick={() => {}}>&larr; Back</BackLink>);

    const link = screen.getByRole('button', { name: '← Back' });
    expect(link).toHaveClass('nav-link');
    expect(link.parentElement).toHaveClass('nav-row');
  });

  it('puts an aside link at the far end of the same row', () => {
    const onForward = vi.fn();
    render(
      <BackLink onClick={() => {}} aside={<ForwardLink onClick={onForward} aria-label="View exercise history for Squat">Exercise history &rarr;</ForwardLink>}>
        &larr; All exercises
      </BackLink>,
    );

    const back = screen.getByRole('button', { name: '← All exercises' });
    const forward = screen.getByRole('button', { name: 'View exercise history for Squat' });
    expect(forward.parentElement).toBe(back.parentElement);
    expect(forward).toHaveClass('nav-link', 'nav-link--end');
    fireEvent.click(forward);
    expect(onForward).toHaveBeenCalled();
  });
});
