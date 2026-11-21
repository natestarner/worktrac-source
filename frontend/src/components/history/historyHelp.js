// The "?" beside History's record-badge key (HistoryTab's RecordLegend), shown by ChartHelp.
//
// Until 2026-11-20 that "?" was a link that left History for the handbook. Every other "?" in the
// app opens an explanation in place, so this one now does too, and keeps the handbook one tap
// further away through `more`.
//
// The badge names come from the record specs (exerciseMetrics.js's `pr.badgeLabel`), the same
// words the key itself shows beside each glyph, so the two cannot disagree. Each sentence restates
// the handbook's History section (HelpTab.jsx, "Records look the same everywhere" and the paragraph
// above it); user-facing-help.md lists the rules both depend on, so a change to one is a change to
// both.
import { prSpec } from '../trends/exerciseMetrics';

const est1rm = prSpec('est1rm').badgeLabel;
const heaviest = prSpec('heaviest').badgeLabel;
const volume = prSpec('sessionVolume').badgeLabel;

export const RECORD_BADGES_HELP = {
  // Unchanged from the link it replaces, so it is still "How records work" to a screen reader. It
  // must not contain another History control's name: Playwright matches names as substrings.
  label: 'How records work',
  title: 'Record badges',
  lines: [
    'A badge marks the set that beat your previous best for that exercise. Matching your best again is not marked a second time.',
    `${est1rm}: your best single effort. That is an estimated 1RM on a loaded lift, the most reps on a bodyweight exercise, and the longest time on a hold.`,
    `${heaviest}: the heaviest weight you have lifted on that exercise.`,
    `${volume}: the most volume in one workout. It sits beside the exercise name rather than on one set, because no single set is the answer.`,
    'The same badges mark a record on the Log tab while you are still lifting, and here afterwards.',
  ],
  more: { label: 'More about History in the Help page', to: '/app/help#history' },
};
