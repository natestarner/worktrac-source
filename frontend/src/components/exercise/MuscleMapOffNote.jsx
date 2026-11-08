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
      {muscleMap.canChange ? (
        <>The muscle highlighter is off by default. To turn it on, visit the {settings}.</>
      ) : (
        <>
          The muscle highlighter is off by default. Your {muscleMap.owner} can turn it on from the{' '}
          {settings}.
        </>
      )}
    </p>
  );
}
