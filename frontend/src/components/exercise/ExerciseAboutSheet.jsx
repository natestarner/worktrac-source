import Modal from '../shared/Modal';
import Button from '../shared/Button';
import SectionLabel from '../shared/SectionLabel';
import { useEffect, useRef } from 'react';
import BodyMap from './BodyMap';
import ExerciseVideoCard from './ExerciseVideoCard';
import { muscleName } from '../../utils/muscles';

// "About this exercise": what it works, drawn on a body, front and back. Opened from the strip
// under the exercise's name (ExerciseAboutStrip). A bottom sheet on a phone, capped in width on an
// iPad; it scrolls when it has to, so the how-to video can sit below the diagram.
//
// Nothing in here touches the network: the muscles come with the exercise catalog (cached for
// offline use like the names), and the body art is a build asset. So it opens and draws the same
// in every connectivity mode -- parity-exercise-about.spec.ts holds it to that.
//
// The body figure is a per-person display preference (PERSON_DEFAULTS.bodyFigure). Until it is
// set, the sheet asks instead of guessing; the same two-button switch then stays under the diagram.
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

// `video` (utils/exerciseVideo.js) adds the how-to video below the muscles. `focusVideo` is set when
// the strip's play button opened the sheet: it scrolls the video into view, so a tap on "play" lands
// on the player rather than on a diagram above it.
// The sheet's contents, without the sheet. The routine editor shows them INSIDE its own dialog
// (RoutineFormModal's preview), because a sheet over a dialog is two scrims and two focus traps.
export function ExerciseAboutContent({ exerciseName, muscles, bodyFigure, onChooseFigure, onAddMuscles = null, video = null, focusVideo = false, children }) {
  const hasMuscles = muscles.primary.length > 0;
  const videoRef = useRef(null);
  useEffect(() => {
    // jsdom defines no scrollIntoView; degrade to no scroll.
    if (focusVideo) videoRef.current?.scrollIntoView?.({ block: 'start' });
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
          <div className="exercise-about-lists">
            <MuscleList title="Main muscles" codes={muscles.primary} tone="primary" />
            <MuscleList title="Helping muscles" codes={muscles.secondary} tone="secondary" />
          </div>
        </>
      )}
      <div ref={videoRef}>
        <ExerciseVideoCard video={video} exerciseName={exerciseName} />
      </div>
      {children}
      {/* The body art's licence travels with the art (MIT requires the notice in every copy).
          A <details> so it costs one line until someone opens it. */}
      <details className="exercise-about-credit">
        <summary>Body art credit</summary>
        <p>
          Body illustrations and muscle outlines: js-rich-body-highlighter 0.1.1. MIT License.
          Copyright (c) 2026 js-rich-body-highlighter contributors.
        </p>
        <p>
          Permission is hereby granted, free of charge, to any person obtaining a copy of this
          software and associated documentation files (the &ldquo;Software&rdquo;), to deal in the
          Software without restriction, including without limitation the rights to use, copy,
          modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
          permit persons to whom the Software is furnished to do so, subject to the following
          conditions: The above copyright notice and this permission notice shall be included in
          all copies or substantial portions of the Software.
        </p>
        <p>
          THE SOFTWARE IS PROVIDED &ldquo;AS IS&rdquo;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
          PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
          BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT
          OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
          DEALINGS IN THE SOFTWARE.
        </p>
      </details>
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
