import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MuscleMapCard from './MuscleMapCard';

const ON = { on: true, canChange: true, owner: 'household owner' };

const sets = (over = {}) => ({
  totalSets: 9,
  worked: [
    { code: 'chest', name: 'Chest', sets: 6 },
    { code: 'triceps', name: 'Triceps', sets: 3.5 },
    { code: 'shoulders', name: 'Shoulders', sets: 0.5 },
  ],
  notWorked: [
    { code: 'calves', name: 'Calves' },
    { code: 'neck', name: 'Neck' },
  ],
  conditioning: 0,
  unlisted: [],
  ...over,
});

describe('MuscleMapCard', () => {
  it('lists each worked muscle with its sets, most-worked first, under the range it covers', () => {
    render(<MuscleMapCard muscleSets={sets()} weeks={12} muscleMap={ON} />);
    expect(screen.getByText(/Muscles worked/)).toHaveTextContent('Muscles worked · last 12 weeks');
    const rows = within(screen.getByRole('list', { name: 'Sets per muscle' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Chest6 sets', 'Triceps3.5 sets', 'Shoulders0.5 sets']);
  });

  it('draws each bar solid, sized by sets -- the shade is the body\'s job, not the bar\'s', () => {
    const { container } = render(<MuscleMapCard muscleSets={sets()} weeks={4} muscleMap={ON} />);
    const bars = [...container.querySelectorAll('.muscle-map-bar')];
    expect(bars.map((b) => b.style.width)).toEqual(['100%', `${(3.5 / 6) * 100}%`, `${(0.5 / 6) * 100}%`]);
    expect(bars.every((b) => b.style.opacity === '')).toBe(true);
  });

  it('draws a front and a back body, each named for a screen reader', () => {
    render(<MuscleMapCard muscleSets={sets()} weeks={4} muscleMap={ON} />);
    expect(screen.getByRole('img', { name: 'Front of the body, shaded by sets per muscle' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Back of the body, shaded by sets per muscle' })).toBeInTheDocument();
  });

  it('names the muscles that got no sets', () => {
    render(<MuscleMapCard muscleSets={sets()} weeks={4} muscleMap={ON} />);
    expect(screen.getByText('Not worked: Calves, Neck.')).toBeInTheDocument();
  });

  it('says what was left off the body, and why', () => {
    render(
      <MuscleMapCard
        muscleSets={sets({ conditioning: 4, unlisted: [{ name: 'Qwerty Zorp', sets: 2 }] })}
        weeks={4}
        muscleMap={ON}
      />,
    );
    expect(screen.getByText(/Plus 4 sets of conditioning/)).toBeInTheDocument();
    expect(screen.getByText(/Qwerty Zorp \(2 sets\)/)).toHaveTextContent(/no muscles are listed/);
  });

  it('shows the bodies unshaded, with no list, when nothing counted toward a muscle', () => {
    render(
      <MuscleMapCard
        muscleSets={sets({ worked: [], conditioning: 3 })}
        weeks={4}
        muscleMap={ON}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Sets per muscle' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Front of the body, no muscles shaded' })).toBeInTheDocument();
    expect(screen.queryByText(/Not worked/)).not.toBeInTheDocument();
  });

  it('renders nothing when there is no catalog to read muscles from', () => {
    const { container } = render(<MuscleMapCard muscleSets={null} weeks={4} muscleMap={ON} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The muscle highlighter is off: no bodies, the note with its link, and the list unchanged.
  it('shows the note instead of the bodies while the muscle highlighter is off', () => {
    render(
      <MemoryRouter>
        <MuscleMapCard muscleSets={sets()} weeks={4} muscleMap={{ on: false, canChange: true, owner: 'household owner' }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('img', { name: /of the body/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings page' })).toHaveAttribute('href', '/app/settings');
    expect(screen.getByRole('list', { name: 'Sets per muscle' })).toBeInTheDocument();
  });

  it('is off when no setting is passed', () => {
    render(
      <MemoryRouter>
        <MuscleMapCard muscleSets={sets()} weeks={4} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('img', { name: /of the body/ })).toBeNull();
  });
});
