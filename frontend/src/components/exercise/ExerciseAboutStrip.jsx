import { IconVitruvian } from '../shared/icons';
import { aboutLabel, primaryLine } from './muscleText';

// The exercise's action bar, directly under its name on the Log screen (decided 2026-11-06): the
// "About this exercise" button (the Vitruvian Man icon, plus the main muscles' names when there is
// room), then the exercise's own actions, then the how-to video slot.
//
// The About icon is a glyph at the same 18px as the actions beside it (2026-11-08). It was a tiny
// body with the main muscles shaded, which stood taller than its neighbours; the shaded body now
// lives only in the sheet it opens.
//
// Two layouts, chosen by the STRIP's width (a container query in index.css, never device
// detection -- iPad split view is as narrow as a phone):
//   narrow: five equal slots [about] [actions x3] [video], no muscle text;
//   wide:   [about + "Chest, Triceps"] ......... [actions x3] [video].
//
// ⚠️ ITS HEIGHT IS FIXED and nothing in it waits on data. It renders synchronously from the
// exercise it is given; an exercise with no muscles (a custom one, a temp row created offline, a
// catalog cached before the fields existed) gets the same box. Anything that could change the
// strip's height after first paint would move the steppers under someone's thumb (log-screen.md).
//
// The video slot is always present, and last, and always holds a button: play when the exercise has
// a video, play struck through when it has none (ExerciseDetail decides which). An empty slot read
// as something missing or broken.
export default function ExerciseAboutStrip({ muscles, onOpen, actions, video }) {
  const line = primaryLine(muscles);
  return (
    <div className="exercise-strip-host">
      <div className="exercise-strip">
        <button type="button" className="exercise-strip-about pressable" onClick={onOpen} aria-label={aboutLabel(muscles)}>
          <span className="exercise-strip-icon">
            <IconVitruvian size={18} />
          </span>
          {line && <span className="exercise-strip-muscles">{line}</span>}
        </button>
        {actions}
        <span className="exercise-strip-video">{video}</span>
      </div>
    </div>
  );
}
