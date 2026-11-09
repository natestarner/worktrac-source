import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MusclePicker from './MusclePicker';
import { MUSCLE_GROUPS } from '../../utils/muscles';

function Harness({ initial = { primary: [], secondary: [] }, disabled = false }) {
  const [value, setValue] = useState(initial);
  return <MusclePicker value={value} onChange={setValue} disabled={disabled} />;
}

describe('MusclePicker', () => {
  it('starts with every body area closed, so no muscle chips are drawn', () => {
    render(<Harness />);
    for (const group of MUSCLE_GROUPS) {
      expect(screen.getByRole('button', { name: group.name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('button', { name: /: not worked$/ })).toBeNull();
  });

  it("opens a body area onto just that area's muscles, and closes it again", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Core' }));
    expect(screen.getByRole('button', { name: 'Core' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /: not worked$/ }).map((b) => b.textContent)).toEqual([
      'Abs',
      'Obliques',
      'Hip flexors',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Core' }));
    expect(screen.queryByRole('button', { name: /: not worked$/ })).toBeNull();
  });

  it('cycles a muscle primary -> secondary -> cleared under a hint that never changes', () => {
    render(<Harness />);
    const hint = 'Tap once for primary, twice for secondary.';
    expect(screen.getByText(hint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Legs' }));

    fireEvent.click(screen.getByRole('button', { name: 'Quads: not worked' }));
    expect(screen.getByRole('button', { name: 'Quads: primary' })).toHaveClass('muscle-chip--primary');
    expect(screen.getByText(hint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quads: primary' }));
    expect(screen.getByRole('button', { name: 'Quads: secondary' })).toHaveClass('muscle-chip--secondary');
    expect(screen.getByText(hint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quads: secondary' }));
    expect(screen.getByRole('button', { name: 'Quads: not worked' })).toHaveClass('muscle-chip--off');
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('names what is picked on each closed row, primary first, and says nothing on an empty one', () => {
    render(<Harness initial={{ primary: ['glutes', 'quads'], secondary: ['hamstrings', 'abs'] }} />);
    expect(screen.getByRole('button', { name: 'Legs' })).toHaveAccessibleDescription(
      'Primary: Glutes, Quads. Secondary: Hamstrings.',
    );
    expect(screen.getByRole('button', { name: 'Core' })).toHaveAccessibleDescription('Secondary: Abs.');
    expect(screen.getByRole('button', { name: 'Chest and arms' })).toHaveAccessibleDescription('');
  });

  it('keeps vocabulary order whatever order the muscles were tapped in', () => {
    let last = null;
    function Spy() {
      const [value, setValue] = useState({ primary: [], secondary: [] });
      return (
        <MusclePicker
          value={value}
          onChange={(next) => {
            last = next;
            setValue(next);
          }}
        />
      );
    }
    render(<Spy />);
    fireEvent.click(screen.getByRole('button', { name: 'Legs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calves: not worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Glutes: not worked' }));
    expect(last).toEqual({ primary: ['glutes', 'calves'], secondary: [] });
  });

  it('can still be opened to read when disabled, but no muscle changes', () => {
    render(<Harness initial={{ primary: ['biceps'], secondary: [] }} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Chest and arms' }));
    const biceps = screen.getByRole('button', { name: 'Biceps: primary' });
    expect(biceps).toBeDisabled();
    fireEvent.click(biceps);
    expect(screen.getByRole('button', { name: 'Biceps: primary' })).toBeInTheDocument();
  });
});
