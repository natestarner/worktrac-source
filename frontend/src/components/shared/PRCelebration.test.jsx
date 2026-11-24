import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PRCelebration from './PRCelebration';
import { useUI } from '../../context/UIContext';

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

// The celebration payload is { exerciseName, prs: [{ type, valueText, caption }], firstTime }.
// ExerciseDetail decides every string; this component only lays them out. That split is the fix
// for the weighted-hold regression pinned below -- see PRCelebration.jsx's header.
function celebrate(exerciseName, prs, firstTime = false) {
  return { exerciseName, prs, firstTime };
}

describe('PRCelebration', () => {
  it('renders nothing when there is no active celebration', () => {
    useUI.mockReturnValue({ celebration: null, dismissCelebration: vi.fn() });
    const { container } = render(<PRCelebration />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the weight/1RM calc for a weighted PR', () => {
    useUI.mockReturnValue({
      celebration: celebrate('Bench Press', [
        { type: 'est1rm', label: 'Est. 1RM', valueText: '208 lb', caption: '185 lb × 5' },
      ]),
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('208 lb')).toBeInTheDocument();
    // The measure is named by the badge now, not by the caption -- see PrBadge's `label`.
    expect(screen.getByText('Est. 1RM')).toBeInTheDocument();
    expect(screen.getByText('185 lb × 5')).toBeInTheDocument();
  });

  it('shows reps instead of the weight/1RM calc for a bodyweight PR', () => {
    useUI.mockReturnValue({
      celebration: celebrate('Pull-Up', [
        { type: 'est1rm', label: 'Most reps', valueText: '12 reps', caption: 'Bodyweight' },
      ]),
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('12 reps')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    // ⚠️ THE BADGE MUST NOT SAY "Est. 1RM" HERE. A bodyweight record is a rep count, and calling
    // it an estimated 1RM is the "rep count wearing a costume" mistake trends.md forbids -- the
    // rule is name all three cases or name none.
    expect(screen.queryByText(/Est\. 1RM/)).not.toBeInTheDocument();
    expect(screen.getByText('Most reps')).toBeInTheDocument();
  });

  // THE REGRESSION. The caption used to be a boolean this component turned into the literal word
  // "Bodyweight", and ExerciseDetail set it for every hold -- so a hold logged WITH weight on it
  // was captioned "Bodyweight", contradicting the number the person had just typed.
  it('names the load on a weighted hold instead of calling it bodyweight', () => {
    useUI.mockReturnValue({
      celebration: celebrate('Weighted Plank', [
        { type: 'est1rm', label: 'Longest hold', valueText: '1:00 hold', caption: 'Weighted · 25 lb' },
      ]),
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('1:00 hold')).toBeInTheDocument();
    expect(screen.getByText('Weighted · 25 lb')).toBeInTheDocument();
    expect(screen.queryByText('Bodyweight')).not.toBeInTheDocument();
  });

  // The other half: an unweighted hold IS a bodyweight hold, so that caption stays correct there.
  // Only the weighted case was ever wrong.
  it('still says bodyweight for a hold with no weight on it', () => {
    useUI.mockReturnValue({
      celebration: celebrate('Plank', [
        { type: 'est1rm', label: 'Longest hold', valueText: '1:00 hold', caption: 'Bodyweight' },
      ]),
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    expect(screen.getByText('1:00 hold')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
  });

  describe('more than one record at once', () => {
    // ONE overlay, not a queue. Three queued overlays at the old 2800ms each would have blocked
    // the screen for 8.4 seconds between sets.
    it('renders a row per record taken, under a single headline', () => {
      useUI.mockReturnValue({
        celebration: celebrate('Deadlift', [
          { type: 'heaviest', valueText: '315 lb', caption: '315 lb × 3' },
          { type: 'est1rm', valueText: '346.5 lb', caption: 'Est. 1RM · 315 lb × 3' },
        ]),
        dismissCelebration: vi.fn(),
      });
      render(<PRCelebration />);

      expect(screen.getAllByText('New PR!')).toHaveLength(1);
      expect(screen.getByText('315 lb')).toBeInTheDocument();
      expect(screen.getByText('346.5 lb')).toBeInTheDocument();
    });

    // The headline is pinned copy: ~18 e2e specs assert getByText('New PR!'), and Playwright's
    // substring match is case-insensitive but still includes the "!", so "2 new PRs!" would match
    // none of them.
    it('keeps the headline as "New PR!" even with three records', () => {
      useUI.mockReturnValue({
        celebration: celebrate('Squat', [
          { type: 'heaviest', valueText: '225 lb', caption: '225 lb × 5' },
          { type: 'est1rm', valueText: '262.5 lb', caption: 'Est. 1RM · 225 lb × 5' },
          { type: 'sessionVolume', valueText: '5400 lb', caption: '5 sets this workout' },
        ]),
        dismissCelebration: vi.fn(),
      });
      render(<PRCelebration />);

      expect(screen.getByText('New PR!')).toBeInTheDocument();
      expect(screen.getByText('5400 lb')).toBeInTheDocument();
      expect(screen.getByText('5 sets this workout')).toBeInTheDocument();
    });
  });

  describe('a first-ever set is a starting mark, not a record', () => {
    // The first set of anything beats nothing, so it technically takes every record at once.
    // Claiming PRs for it is how the celebration gets cheap -- a new person's first workout popped
    // "New PR!" on 5 of 6 sets. Same card, quieter: see PRCelebration.jsx's header.
    const STARTING_MARK = [{ type: 'startingMark', valueText: '135 lb × 8', caption: 'Your starting mark' }];
    const confettiIn = (container) =>
      Array.from(container.querySelectorAll('span')).filter((el) => (el.getAttribute('style') || '').includes('confettiFall'));

    it('says "First <exercise>", shows the set as the starting mark, and says what beating it means', () => {
      useUI.mockReturnValue({ celebration: celebrate('Barbell Bench Press', STARTING_MARK, true), dismissCelebration: vi.fn() });
      const { container } = render(<PRCelebration />);

      expect(screen.getByRole('dialog', { name: 'First Barbell Bench Press' })).toBeInTheDocument();
      expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
      expect(screen.getByText('Your starting mark')).toBeInTheDocument();
      expect(screen.getByText('Beat it and it’s a new PR.')).toBeInTheDocument();
      // Not a record: no "New PR!", no record badge, no confetti.
      expect(screen.queryByText('New PR!')).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Personal record|Est\. 1RM|Top weight/i)).not.toBeInTheDocument();
      expect(confettiIn(container)).toHaveLength(0);
      // The same exits as every celebration.
      expect(screen.getByRole('button', { name: 'Nice' })).toBeInTheDocument();
    });

    it("names the person when the caller passes one (\"Sam's first ...\")", () => {
      useUI.mockReturnValue({
        celebration: { ...celebrate('Barbell Bench Press', STARTING_MARK, true), personFirstName: 'Sam' },
        dismissCelebration: vi.fn(),
      });
      render(<PRCelebration />);

      expect(screen.getByRole('dialog', { name: 'Sam’s first Barbell Bench Press' })).toBeInTheDocument();
    });

    it('dismisses on Escape, the button and a scrim tap, like the full card', () => {
      const dismissCelebration = vi.fn();
      useUI.mockReturnValue({ celebration: celebrate('Plank', STARTING_MARK, true), dismissCelebration });
      const { container } = render(<PRCelebration />);

      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Nice' }));
      fireEvent.click(container.firstChild);
      expect(dismissCelebration.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('keeps the confetti, the record badge and "New PR!" for a genuine record', () => {
      useUI.mockReturnValue({
        celebration: celebrate('Overhead Press', [{ type: 'est1rm', label: 'Est. 1RM', valueText: '115 lb', caption: '105 lb × 3' }]),
        dismissCelebration: vi.fn(),
      });
      const { container } = render(<PRCelebration />);

      expect(screen.getByRole('dialog', { name: 'New PR!' })).toBeInTheDocument();
      expect(screen.getByText('Est. 1RM')).toBeInTheDocument();
      expect(screen.queryByText('Beat it and it’s a new PR.')).not.toBeInTheDocument();
      expect(confettiIn(container).length).toBeGreaterThan(0);
    });
  });

  // A persistent full-screen scrim is an app-bricking shape if it can ever fail to close, so each
  // exit is pinned separately -- none of them may depend on the others. (The fourth exit, a
  // reload, is structural: this state lives in UIContext memory and is never persisted.)
  describe('every way out', () => {
    function renderOpen() {
      const dismissCelebration = vi.fn();
      useUI.mockReturnValue({
        celebration: celebrate('Row', [{ type: 'est1rm', valueText: '150 lb', caption: 'Est. 1RM · 135 lb × 8' }]),
        dismissCelebration,
      });
      const utils = render(<PRCelebration />);
      return { ...utils, dismissCelebration };
    }

    it('dismisses on the footer button', () => {
      const { dismissCelebration } = renderOpen();
      fireEvent.click(screen.getByRole('button', { name: 'Nice' }));
      expect(dismissCelebration).toHaveBeenCalled();
    });

    it('dismisses on Escape', () => {
      const { dismissCelebration } = renderOpen();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(dismissCelebration).toHaveBeenCalled();
    });

    // Eight e2e specs dismiss this with a scrim click, and frontend-core.md names that as the
    // reason this is deliberately NOT a Modal (which never closes on a backdrop tap).
    it('dismisses on a scrim tap', () => {
      const { container, dismissCelebration } = renderOpen();
      fireEvent.click(container.firstChild);
      expect(dismissCelebration).toHaveBeenCalled();
    });

    // ⚠️ A tap on the CARD dismisses too, and that is load-bearing rather than incidental: the
    // e2e helpers and ~18 specs dismiss this with `getByText('New PR!').click()`, and that text is
    // the title, inside the panel. A stopPropagation on the panel makes the card inert and hangs
    // every one of them on an intercepted click -- which is exactly what happened when one was
    // added. It is also the kinder behaviour: there is nothing to lose by dismissing a
    // congratulation, so the whole overlay is one target.
    it('dismisses on a tap on the card itself, not just the scrim', () => {
      const { dismissCelebration } = renderOpen();
      fireEvent.click(screen.getByText('New PR!'));
      expect(dismissCelebration).toHaveBeenCalled();
    });
  });

  it('is a labelled dialog and puts focus inside itself', () => {
    useUI.mockReturnValue({
      celebration: celebrate('Row', [{ type: 'est1rm', valueText: '150 lb', caption: 'Est. 1RM · 135 lb × 8' }]),
      dismissCelebration: vi.fn(),
    });
    render(<PRCelebration />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Nice' })).toHaveFocus();
  });
});
