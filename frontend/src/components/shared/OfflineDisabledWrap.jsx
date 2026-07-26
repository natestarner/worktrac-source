import { cloneElement } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

// Greys out and disables a single entry-point control (a raw <button> or the shared <Button>)
// that requires a connection, adding a `title` tooltip as a desktop bonus. Clones the child in
// place rather than adding a wrapping DOM node, so it drops into an existing flex/grid layout
// (flex:1, width:100%, etc.) without disturbing the parent's sizing -- and unlike a wrapping
// <span title>, a plain `disabled` + `title` on the control itself is all that's needed here,
// since the primary targets (iPad/iPhone) have no hover to begin with.
// `when` lets a caller add a second condition beyond "offline" (e.g. SessionSummary only
// disables Remove offline if the entry has an already-synced set); omit it to disable on
// offline alone.
export default function OfflineDisabledWrap({ children, message = 'Not available offline', when = true }) {
  const online = useOnlineStatus();
  if (online || !when) return children;
  return cloneElement(children, {
    disabled: true,
    title: message,
    style: { ...(children.props.style || {}), opacity: 0.5, cursor: 'not-allowed' },
  });
}
