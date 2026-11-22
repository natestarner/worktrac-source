// How tall a History workout block will be before it is drawn.
//
// The blocks carry `content-visibility: auto` (index.css's .history-block), so one that has never
// been drawn takes its size from this estimate (HistoryTab's `containIntrinsicSize`). When it is
// drawn, it swaps the estimate for its real height. Chrome anchors the scroll through that; Safari
// has no scroll anchoring, so everything below the block moves on screen. Scrolling back up a
// History in WebKit, the old estimate (80px + 72px per exercise, which ignored how many sets an
// exercise has and whether it carries a note) moved the page 12-14 times in 3,600px of scrolling,
// up to 120px at once.
//
// Fitted in WebKit at iPhone 15 width (2026-11-21) against blocks forced to draw, every case within
// 2px: 38px per block, 52px per exercise, 31.5px per row of set pills, and 18px per line of note
// (at most two; it is clamped) plus the 6px gap the note and tag lines each leave.

const BLOCK_PX = 38;
const ENTRY_PX = 52;
const PILL_ROW_PX = 31.5;
const LINE_PX = 18;
const LINE_GAP_PX = 6;
// A typical set pill ("120lb×5") and the 6px gap after it.
const PILL_SLOT_PX = 78;
// The average width of a character in the 12px italic note.
const NOTE_CHAR_PX = 6.5;

// The width an iPhone gives a row of set pills: the estimate's width until one has been measured.
export const DEFAULT_ROW_WIDTH = 255;

export function pillsPerRow(rowWidth) {
  return Math.max(1, Math.floor((rowWidth + 6) / PILL_SLOT_PX));
}

// `entries` are a workout's exercises as History holds them ({ sets, note }); `hasTags(entry)`
// says whether an exercise shows a line of tags (one line, like a short note).
export function estimatedSessionBlockHeight(entries, rowWidth = DEFAULT_ROW_WIDTH, hasTags = () => false) {
  const perRow = pillsPerRow(rowWidth);
  const charsPerLine = Math.max(1, Math.floor(rowWidth / NOTE_CHAR_PX));
  let height = BLOCK_PX;
  for (const entry of entries) {
    height += ENTRY_PX + PILL_ROW_PX * Math.ceil((entry.sets?.length || 0) / perRow);
    if (entry.note) height += LINE_GAP_PX + LINE_PX * Math.min(2, Math.ceil(entry.note.length / charsPerLine));
    if (hasTags(entry)) height += LINE_GAP_PX + LINE_PX;
  }
  return Math.round(height);
}
