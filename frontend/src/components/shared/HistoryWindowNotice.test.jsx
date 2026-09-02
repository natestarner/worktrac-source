import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import HistoryWindowNotice from './HistoryWindowNotice';

const HIDDEN = {
  windowStart: '2026-03-17T12:00:00Z',
  hiddenSessions: 47,
  earliestHiddenAt: '2024-03-12T10:00:00Z',
};

function renderNotice(props) {
  return render(
    <MemoryRouter>
      <HistoryWindowNotice {...props} />
    </MemoryRouter>,
  );
}

describe('HistoryWindowNotice', () => {
  it('tells a Free household exactly how much is hidden, and offers a way to see it', () => {
    renderNotice({ plan: 'FREE', historyWindow: HIDDEN });

    expect(screen.getByText(/Your full history has 47 more workouts\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See Pro' })).toBeInTheDocument();
  });

  it('prefixes the tab-specific lead when one is given', () => {
    renderNotice({ plan: 'FREE', historyWindow: HIDDEN, lead: 'Bests here cover the last 90 days.' });

    expect(
      screen.getByText(/Bests here cover the last 90 days\. Your full history has 47 more workouts/),
    ).toBeInTheDocument();
  });

  // ⚠️ The three fail-closed gates. Each is asserted separately because each silences the notice on
  // its own, and a single combined case would pass with two of them deleted.
  describe('renders nothing unless there is something true to say', () => {
    it('when the household is Pro', () => {
      const { container } = renderNotice({ plan: 'PRO', historyWindow: HIDDEN });
      expect(container).toBeEmptyDOMElement();
    });

    // The one that matters most: an auth snapshot written before billing shipped carries no plan,
    // and showing someone who already pays a notice about what they cannot see is the worst outcome
    // available here. Absence is the safe default -- same call PlanBadge and ProUpsell make.
    it('when the plan is unknown', () => {
      const { container } = renderNotice({ plan: undefined, historyWindow: HIDDEN });
      expect(container).toBeEmptyDOMElement();
    });

    it('when the server has not answered yet', () => {
      const { container } = renderNotice({ plan: 'FREE', historyWindow: null });
      expect(container).toBeEmptyDOMElement();
    });

    // The common case by a distance: a Free household inside its first 90 days. They should see no
    // change anywhere in the app.
    it('when nothing is actually hidden', () => {
      const { container } = renderNotice({
        plan: 'FREE',
        historyWindow: { windowStart: HIDDEN.windowStart, hiddenSessions: 0, earliestHiddenAt: null },
      });
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('the explainer', () => {
    it('stays closed until asked for, so nothing interrupts anyone', () => {
      renderNotice({ plan: 'FREE', historyWindow: HIDDEN });
      expect(screen.queryByText(/Nothing is deleted, ever/)).not.toBeInTheDocument();
    });

    it('opens on the why control and leads with the reassurance, not the pitch', () => {
      renderNotice({ plan: 'FREE', historyWindow: HIDDEN });

      fireEvent.click(screen.getByRole('button', { name: 'About your full history' }));

      expect(screen.getByText(/Nothing is deleted, ever/)).toBeInTheDocument();
      // Names a real date rather than an abstraction.
      expect(screen.getByText(/goes back to Mar 12, 2024/)).toBeInTheDocument();
      // The benefits come from planCopy's PRO_BENEFITS, not retyped prose.
      expect(screen.getByText(/Your whole history/)).toBeInTheDocument();
      // The two facts a less honest version would omit.
      expect(screen.getByText(/detected against your whole\s+history/)).toBeInTheDocument();
      expect(screen.getByText(/free on both plans/)).toBeInTheDocument();
    });

    // ⚠️ Playwright matches an accessible name as a case-insensitive SUBSTRING, and all four of
    // these are in the DOM together once the explainer is open (the header's "Go Pro" lives outside
    // this component but on the same screen). A shared substring makes every getByRole on any of
    // them a strict-mode violation somewhere else in the suite. See .claude/rules/billing.md.
    it('keeps its control names non-containing with the notice and the modal chrome', () => {
      renderNotice({ plan: 'FREE', historyWindow: HIDDEN });
      fireEvent.click(screen.getByRole('button', { name: 'About your full history' }));

      const names = [
        'See Pro',
        'About your full history',
        'Unlock full history',
        'How Free and Pro differ',
        'Close',
        'Go Pro',
      ];
      for (const a of names) {
        for (const b of names) {
          if (a === b) continue;
          expect(b.toLowerCase().includes(a.toLowerCase())).toBe(false);
        }
      }

      // ...and the three that this component actually renders are really on screen under those
      // exact names, so the list above cannot quietly stop describing the UI.
      expect(screen.getByRole('link', { name: 'See Pro' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unlock full history' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'How Free and Pro differ' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    // Singular is a real case (one out-of-window workout is exactly what the "log a past workout"
    // flow produces), and it reads wrong under a naive plural template -- "1 workout ... sit
    // outside". This is the sentence that asks someone for money.
    it('agrees with itself at one workout', () => {
      renderNotice({
        plan: 'FREE',
        historyWindow: { ...HIDDEN, hiddenSessions: 1 },
      });
      fireEvent.click(screen.getByRole('button', { name: 'About your full history' }));

      expect(
        screen.getByText(/Your full\s+history goes back to Mar 12, 2024 and holds 1 more workout\./),
      ).toBeInTheDocument();
    });

    it('and at more than one', () => {
      renderNotice({ plan: 'FREE', historyWindow: HIDDEN });
      fireEvent.click(screen.getByRole('button', { name: 'About your full history' }));

      expect(
        screen.getByText(/Your full\s+history goes back to Mar 12, 2024 and holds 47 more workouts\./),
      ).toBeInTheDocument();
    });

    it('closes again', () => {
      renderNotice({ plan: 'FREE', historyWindow: HIDDEN });
      fireEvent.click(screen.getByRole('button', { name: 'About your full history' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByText(/Nothing is deleted, ever/)).not.toBeInTheDocument();
    });
  });
});
