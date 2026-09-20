import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SetPillRow from './SetPillRow';

describe('SetPillRow', () => {
  it('renders nothing when there are no sets', () => {
    const { container } = render(<SetPillRow sets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each set as its own separately-readable pill, not one run-together string', () => {
    render(
      <SetPillRow
        sets={[
          { id: 1, weight: 135, reps: 5, unit: 'lb' },
          { id: 2, weight: 145, reps: 5, unit: 'lb' },
          { id: 3, weight: 155, reps: 3, unit: 'lb' },
        ]}
      />,
    );
    expect(screen.getByText('135lb×5')).toBeInTheDocument();
    expect(screen.getByText('145lb×5')).toBeInTheDocument();
    expect(screen.getByText('155lb×3')).toBeInTheDocument();
  });

  it('renders a plain pill for every set when prMarks is omitted (no regression)', () => {
    render(<SetPillRow sets={[{ id: 1, weight: 135, reps: 5, unit: 'lb' }]} />);
    expect(screen.queryByTitle(/Personal record/)).not.toBeInTheDocument();
  });

  it('marks only the sets flagged in prMarks as a PR, index-aligned to sets', () => {
    render(
      <SetPillRow
        sets={[
          { id: 1, weight: 135, reps: 5, unit: 'lb' },
          { id: 2, weight: 155, reps: 5, unit: 'lb' },
        ]}
        prMarks={[[], ['est1rm']]}
      />,
    );
    const prPill = screen.getByTitle(/Personal record/);
    expect(prPill.textContent).toContain('155lb×5');
    // The non-PR pill has no title/aria-label of its own.
    expect(screen.getByText('135lb×5')).not.toHaveAttribute('title');
  });

  // ⚠️ The accessible name keeps the words "personal record" and APPENDS the type. ~40 e2e
  // assertions and parity-pr-record.spec.ts select on that phrasing, so a rewrite would break
  // every one of them while an append breaks none.
  describe('naming which record fell', () => {
    it('names the type after the existing "personal record" phrase', () => {
      render(<SetPillRow sets={[{ id: 1, weight: 155, reps: 5, unit: 'lb' }]} prMarks={[['heaviest']]} />);
      expect(screen.getByTitle(/Personal record/)).toHaveAccessibleName('155lb×5, personal record: top weight');
    });

    it('names both when one set takes two records', () => {
      render(<SetPillRow sets={[{ id: 1, weight: 155, reps: 5, unit: 'lb' }]} prMarks={[['heaviest', 'est1rm']]} />);
      expect(screen.getByTitle(/Personal record/)).toHaveAccessibleName(
        '155lb×5, personal record: top weight, est. 1rm',
      );
    });

    // ⚠️ The est.-1RM record is a REP COUNT at weight 0 and SECONDS for a hold, so naming it
    // "est. 1rm" on a pull-up or a plank is the "rep count wearing a costume" mistake trends.md
    // forbids -- and it has to be avoided on History too, not just in the celebration overlay.
    // The same record must not be "Longest hold" in the overlay and "est. 1rm" on the row it made.
    it('names a bodyweight record by its reps, not as an estimated 1RM', () => {
      render(<SetPillRow sets={[{ id: 1, weight: 0, reps: 12, unit: 'lb' }]} prMarks={[['est1rm']]} />);
      // formatSet spells a bodyweight set "0lb×12" -- existing behaviour, not part of this change.
      expect(screen.getByTitle(/Personal record/)).toHaveAccessibleName('0lb×12, personal record: most reps');
    });

    it('names a hold record by its duration', () => {
      render(
        <SetPillRow
          sets={[{ id: 1, weight: 0, reps: 0, durationSeconds: 60, unit: 'lb' }]}
          prMarks={[['est1rm']]}
        />,
      );
      expect(screen.getByTitle(/Personal record/)).toHaveAccessibleName('1:00, personal record: longest hold');
    });

    // A weighted hold takes the top-weight record too -- reps are 0 so volume cannot fire, but the
    // load is real. Both names have to be right in the same label.
    it('names both records on a weighted hold', () => {
      render(
        <SetPillRow
          sets={[{ id: 1, weight: 25, reps: 0, durationSeconds: 60, unit: 'lb' }]}
          prMarks={[['heaviest', 'est1rm']]}
        />,
      );
      expect(screen.getByTitle(/Personal record/)).toHaveAccessibleName(
        '25lb×1:00, personal record: top weight, longest hold',
      );
    });

    // Greyscale is the acceptance test for this feature, so the glyphs have to be per-type and
    // present -- the tint is reinforcement only. Two records means two glyphs.
    it('renders one glyph per record taken', () => {
      const { container } = render(
        <SetPillRow sets={[{ id: 1, weight: 155, reps: 5, unit: 'lb' }]} prMarks={[['heaviest', 'est1rm']]} />,
      );
      expect(container.querySelectorAll('svg')).toHaveLength(2);
    });
  });
});
