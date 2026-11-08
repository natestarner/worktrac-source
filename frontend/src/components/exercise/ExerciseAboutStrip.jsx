import BodyMap from './BodyMap';
import { viewFor } from './bodyMapArt';
import { aboutLabel, primaryLine } from './muscleText';
import { IconInfo } from '../shared/icons';

// The exercise's action bar, directly under its name on the Log screen (decided 2026-11-06): the
// "About this exercise" button (a tiny body with the main muscles shaded, plus their names when
// there is room), then the exercise's own actions, then the how-to video slot.
//
// Two layouts, chosen by the STRIP's width (a container query in index.css, never device
// detection -- iPad split view is as narrow as a phone):
//   narrow: five equal slots [body] [actions x3] [video], no muscle text;
//   wide:   [body + "Chest, Triceps"] ......... [actions x3] [video].
//
// ⚠️ ITS HEIGHT IS FIXED and nothing in it waits on data. It renders synchronously from the
// exercise it is given; an exercise with no muscles (a custom one, a temp row created offline, a
// catalog cached before the fields existed) gets the same box with an empty body. Anything that
// could change the strip's height after first paint would move the steppers under someone's thumb
// (log-screen.md).
//
// With the muscle highlighter off (the account-wide setting, `muscleMapOn`), the thumbnail slot holds
// an info icon instead of the body -- same box, so the strip is the same height and width either
// way. A sentence cannot fit in a 44px slot; the sheet the button opens carries the note and the
// link to Settings.
//
// The video slot is always present, and last: an exercise without a video leaves it empty rather
// than closing the gap, so the actions never shift sideways between exercises.
export default function ExerciseAboutStrip({ muscles, bodyFigure, muscleMapOn = false, onOpen, actions, video = null }) {
  const line = primaryLine(muscles);
  return (
    <div className="exercise-strip-host">
      <div className="exercise-strip">
        <button type="button" className="exercise-strip-about pressable" onClick={onOpen} aria-label={aboutLabel(muscles)}>
          <span className={muscleMapOn ? 'exercise-strip-thumb' : 'exercise-strip-thumb exercise-strip-thumb--icon'}>
            {muscleMapOn ? (
              <BodyMap
                primary={muscles.primary}
                secondary={muscles.secondary}
                gender={bodyFigure ?? 'male'}
                view={viewFor(muscles.primary)}
              />
            ) : (
              <IconInfo size={20} />
            )}
          </span>
          {line && <span className="exercise-strip-muscles">{line}</span>}
        </button>
        {actions}
        <span className="exercise-strip-video">{video}</span>
      </div>
    </div>
  );
}
