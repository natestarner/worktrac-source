import { useState } from 'react';
import { Link } from 'react-router-dom';
import IconButton from './IconButton';
import Modal from './Modal';
import { IconHelp } from './icons';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// Below this width the explanation rises as a bottom sheet; above it, the same dialog sits centred.
// The same breakpoint DatePickerSheet uses, so every sheet in the app changes shape at one width.
const COMPACT = '(max-width: 599px)';

// The app's one "?": a small button that opens a plain-English explanation of whatever it sits
// beside -- a chart's marks (trends/chartHelp.js), the PRs board's record picker, History's record
// badges (history/historyHelp.js). Every "?" in the app is this component, so they look and behave
// the same.
//
// A SHEET, not an anchored tooltip (2026-11-20, #441). The panel used to hang below the button, and
// on Trends the row below the weekly chart's "?" is its metric switcher: the open panel covered all
// four pills on a 375px phone and two of them on an iPad and a desktop, and a tap on a covered pill
// landed on the panel and did nothing. An explanation of several sentences is a sheet on a phone by
// platform convention (UIKit adapts a popover to one in compact width; Material reserves tooltips
// for a few words), and a sheet covers nothing it doesn't also dim. Going through Modal also brings
// its focus trap, Escape, focus return and visible-viewport sizing for free; this component used to
// carry its own outside-click listener and a measure-and-nudge effect to keep the panel on screen,
// both now gone because a sheet cannot fall off one.
//
// The exits are Modal's: the header's X and Escape. A tap on the dimmed backdrop does NOT close it.
// That is Modal's rule for every dialog in the app (frontend-core.md), and this one follows it
// rather than carving out an exception, so every sheet in the app dismisses the same way.
//
// TAP TO OPEN, never hover: the app is used one-handed mid-workout, where hover does not exist.
// IconButton's `title` still gives a mouse user the label on hover.
//
// `help` is { label, title, lines[], more? }. `label` is the button's accessible name (the labels on
// one screen must not contain one another: Playwright matches names as substrings -- chartHelp.js).
// `lines` are paragraphs. `more`, optional, is { label, to }: a link to the handbook section that
// says the rest, for an explanation too long to live in a sheet. The copy is data rather than
// children so it can sit beside the definition it describes and be unit tested without a render.
//
// The dialog is mounted only while open: its copy repeats phrases other specs on these screens
// select by, and an always-mounted (hidden) copy would collide with them.
export default function ChartHelp({ help }) {
  const [open, setOpen] = useState(false);
  const compact = useMediaQuery(COMPACT);
  const close = () => setOpen(false);

  return (
    <>
      <HelpButton label={help.label} expanded={open} onClick={() => setOpen(true)} />

      {open && (
        <Modal
          align={compact ? 'bottom' : 'center'}
          width={420}
          title={help.title}
          onClose={close}
          // Nothing in here takes input, so focus the dialog itself: the title is announced and Tab
          // still reaches the link and the X. Landing on the X would read as "Close" first.
          initialFocus="dialog"
        >
          <div style={bodyStyle}>
            {help.lines.map((line) => (
              <p key={line} style={lineStyle}>
                {line}
              </p>
            ))}
            {help.more && (
              <Link to={help.more.to} onClick={close} className="pressable" style={moreStyle}>
                {help.more.label}
              </Link>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// The "?" itself, exported for the one "?" whose explanation is richer than a `help` object can hold
// (HistoryWindowNotice's, which opens HistoryWindowModal) -- so it still looks and reads like every
// other "?" in the app. Everything else should render ChartHelp, not this.
export function HelpButton({ label, expanded, onClick }) {
  return (
    <IconButton
      icon={IconHelp}
      label={label}
      size={16}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
      // The 40px .icon-btn box is right for a row of set controls but too heavy beside a 13px
      // heading, so this one shrinks. 32px is below the 44px target the rules ask for, which is
      // acceptable only because nothing is lost by missing it: the worst case is the sheet not
      // opening, and there is no adjacent control to hit by mistake.
      style={{ width: 32, height: 32, marginLeft: -4 }}
    />
  );
}

const bodyStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };

// Body copy in a dialog, not caption text in a tooltip: --text-sm at a comfortable line height,
// in --color-muted like every other explanatory paragraph (never --color-faint).
const lineStyle = { margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.55, color: 'var(--color-muted)' };

const moreStyle = {
  alignSelf: 'flex-start',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-accent-text)',
};
