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

  it('cycles a muscle main -> helping -> cleared, and the hint says what each tap did', () => {
    render(<Harness />);
    expect(screen.getByText('Tap once for main, twice for helping, three times to clear.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Legs' }));

    fireEvent.click(screen.getByRole('button', { name: 'Quads: not worked' }));
    expect(screen.getByRole('button', { name: 'Quads: main' })).toHaveClass('muscle-chip--primary');
    expect(screen.getByText('Quads is a main muscle. Tap it again to make it helping.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quads: main' }));
    expect(screen.getByRole('button', { name: 'Quads: helping' })).toHaveClass('muscle-chip--secondary');
    expect(screen.getByText('Quads is helping. Tap it again to clear it.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quads: helping' }));
    expect(screen.getByRole('button', { name: 'Quads: not worked' })).toHaveClass('muscle-chip--off');
    expect(screen.getByText('Quads cleared.')).toBeInTheDocument();
  });

  it('names what is picked on each closed row, main first, and says nothing on an empty one', () => {
    render(<Harness initial={{ primary: ['glutes', 'quads'], secondary: ['hamstrings', 'abs'] }} />);
    expect(screen.getByRole('button', { name: 'Legs' })).toHaveAccessibleDescription(
      'Main: Glutes, Quads. Helping: Hamstrings.',
    );
    expect(screen.getByRole('button', { name: 'Core' })).toHaveAccessibleDescription('Helping: Abs.');
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
    const biceps = screen.getByRole('button', { name: 'Biceps: main' });
    expect(biceps).toBeDisabled();
    fireEvent.click(biceps);
    expect(screen.getByRole('button', { name: 'Biceps: main' })).toBeInTheDocument();
  });
});
