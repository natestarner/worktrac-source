// The one "← Back" link, at the top of a screen. Every back link in the app renders through this,
// so they share a size (--text-base), a 40px tap target and the gap below them (--space-3). See
// `.nav-row` / `.nav-link` in index.css for why the target is 40px but the row is only as tall as
// its text.
//
// `children` is the visible text, arrow included ("← Back"). It is also the accessible name, which
// e2e specs select by, so pass it verbatim.
//
// `aside` is an optional second link at the far end of the same row -- the Log screen's
// "Exercise history →". Render it with <ForwardLink> so the two match.
//
// It carries its own bottom gap because it always starts a screen: nothing sits above it but the
// tab panel's padding, and whatever follows is the screen's content.
export default function BackLink({ onClick, children, aside = null }) {
  return (
    <div className="nav-row">
      <button type="button" onClick={onClick} className="nav-link pressable">
        {children}
      </button>
      {aside}
    </div>
  );
}

// The same link pointed the other way, for BackLink's `aside` slot.
export function ForwardLink({ onClick, children, ...rest }) {
  return (
    <button type="button" onClick={onClick} className="nav-link nav-link--end pressable" {...rest}>
      {children}
    </button>
  );
}
