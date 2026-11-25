import { Link } from 'react-router-dom';

// What sits where a body diagram would be while the muscle highlighter is off (the account-wide
// setting, off by default -- hooks/useMuscleMap.js). The muscle NAMES around it stay: they are text,
// and the setting is about the drawings.
//
// `link={false}` is for a place where leaving the screen would throw work away -- the routine
// editor's preview, whose unsaved routine lives in that dialog's state. It names Settings without
// linking to it.
//
// The link's name is "Settings page", not "Settings": the account menu holds "App Settings", which
// contains "Settings", and Playwright matches accessible names as a case-insensitive substring.
export default function MuscleMapOffNote({ muscleMap, link = true }) {
  const settings = link ? (
    <Link to="/app/settings" className="muscle-map-off-link">
      Settings page
    </Link>
  ) : (
    'Settings page'
  );
  return (
    <p className="muscle-map-off" data-testid="muscle-map-off">
      {/* An invitation, not a status report (2026-11-25): "is off by default" read like a note to
          an admin. The owner is offered the drawing; anyone else is told why there isn't one and
          who can change it. The handbook still states the default (HelpTab, user-facing-help.md). */}
      {muscleMap.canChange ? (
        <>Want to see these muscles on a body diagram? Turn on the muscle highlighter on the {settings}.</>
      ) : (
        <>
          Body diagrams are turned off. Your {muscleMap.owner} can turn on the muscle highlighter on the{' '}
          {settings}.
        </>
      )}
    </p>
  );
}
