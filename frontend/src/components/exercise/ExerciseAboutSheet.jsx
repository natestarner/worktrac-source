import Modal from '../shared/Modal';
import Button from '../shared/Button';
import SectionLabel from '../shared/SectionLabel';
import BodyMap from './BodyMap';
import ExerciseVideoCard from './ExerciseVideoCard';
import { muscleName } from '../../utils/muscles';
import MuscleMapOffNote from './MuscleMapOffNote';
import { MUSCLE_MAP_OFF } from '../../hooks/useMuscleMap';

// "About this exercise": what it works, drawn on a body, front and back. Opened from the strip
// under the exercise's name (ExerciseAboutStrip). A bottom sheet on a phone, capped in width on an
// iPad. On the Log screen it holds the muscles ONLY: the strip's play button opens the how-to video
// in its own sheet (ExerciseVideoSheet) -- one icon, one sheet (decided 2026-11-08). The previews
// (ExercisePreview.jsx) still show both, since they have a single "About" entry and no play button.
//
// Nothing in here touches the network: the muscles come with the exercise catalog (cached for
// offline use like the names), and the body art is a build asset. So it opens and draws the same
// in every connectivity mode -- parity-exercise-about.spec.ts holds it to that.
//
// The body figure is a per-person display preference (PERSON_DEFAULTS.bodyFigure). Until it is
// set, the sheet asks instead of guessing; the same two-button switch then stays under the diagram.
//
// The diagram, the question and the switch all sit behind the account-wide muscle highlighter
// setting (`muscleMap`, hooks/useMuscleMap.js), off by default. Off, MuscleMapOffNote takes their
// place and the muscle lists stay: they are text, and the setting is about the drawings.
//
// ⚠️ The switch's accessible names are "Show a male body" / "Show a female body", not the visible
// "Male" / "Female": "Male" is a substring of "Female", and Playwright matches names by substring.
// The .seg markup is SegmentedToggle's, written out because that primitive has no
// per-option aria-label.

const FIGURES = [
  { value: 'male', label: 'Male', name: 'Show a male body' },
  { value: 'female', label: 'Female', name: 'Show a female body' },
];

function FigureSwitch({ value, onChange }) {
  return (
    <div role="group" aria-label="Body diagram" className="seg">
      {FIGURES.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          aria-label={f.name}
          aria-pressed={value === f.value}
          className={['seg-item', value === f.value && 'is-active', 'pressable'].filter(Boolean).join(' ')}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function MuscleList({ title, codes, tone }) {
  const names = codes.map(muscleName).filter(Boolean);
  if (names.length === 0) return null;
  return (
    <div className="exercise-about-list">
      <SectionLabel as="h3">{title}</SectionLabel>
      <ul>
        {names.map((name) => (
          <li key={name}>
            <span className={`exercise-about-swatch exercise-about-swatch--${tone}`} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// `video` (utils/exerciseVideo.js) adds the how-to video below the muscles. The previews pass it;
// the Log screen does not, because its play button opens the video in a sheet of its own.
//
// ⚠️ Nothing in here may scrollIntoView. The combined sheet used to scroll to the video when it was
// opened from play, and on iOS Safari that also scrolls the page behind the fixed overlay: the
// sheet's header, Close button included, ended up above the screen with no way to scroll back.
//
// The sheet's contents, without the sheet. The routine editor shows them INSIDE its own dialog
// (RoutineFormModal's preview), because a sheet over a dialog is two scrims and two focus traps.
// `settingsLink={false}` names Settings without linking to it (MuscleMapOffNote says when).
export function ExerciseAboutContent({ exerciseName, muscles, bodyFigure, onChooseFigure, muscleMap = MUSCLE_MAP_OFF, settingsLink = true, onAddMuscles = null, video = null, children }) {
  const hasMuscles = muscles.primary.length > 0;
  return (
    <>
      {!hasMuscles ? (
        <div className="exercise-about-empty">
          <p>No muscles are listed for this exercise yet.</p>
          {onAddMuscles && (
            <Button variant="secondary" onClick={onAddMuscles}>
              Add muscles worked
            </Button>
          )}
        </div>
      ) : (
        <>
          {!muscleMap.on ? (
            <MuscleMapOffNote muscleMap={muscleMap} link={settingsLink} />
          ) : (
            <>
              {bodyFigure ? (
                <div className="exercise-about-bodies">
                  <BodyMap primary={muscles.primary} secondary={muscles.secondary} gender={bodyFigure} view="front" label="Front of the body" />
                  <BodyMap primary={muscles.primary} secondary={muscles.secondary} gender={bodyFigure} view="back" label="Back of the body" />
                </div>
              ) : (
                <p className="exercise-about-ask">Which body should the muscle diagram show?</p>
              )}
              <div className="exercise-about-figure">
                <FigureSwitch value={bodyFigure} onChange={onChooseFigure} />
              </div>
            </>
          )}
          <div className="exercise-about-lists">
            <MuscleList title="Primary muscles" codes={muscles.primary} tone="primary" />
            <MuscleList title="Secondary muscles" codes={muscles.secondary} tone="secondary" />
          </div>
        </>
      )}
      <ExerciseVideoCard video={video} exerciseName={exerciseName} />
      {children}
    </>
  );
}

export default function ExerciseAboutSheet({ exerciseName, onClose, ...content }) {
  return (
    <Modal align="bottom" width={560} title={exerciseName} onClose={onClose} initialFocus="dialog">
      <ExerciseAboutContent exerciseName={exerciseName} {...content} />
    </Modal>
  );
}
