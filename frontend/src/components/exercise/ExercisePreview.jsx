import { useAppState } from '../../context/AppStateContext';
import { useExercises } from '../../hooks/useExercises';
import { exerciseMuscles } from '../../utils/muscles';
import { exerciseVideo } from '../../utils/exerciseVideo';
import { useMuscleMap } from '../../hooks/useMuscleMap';
import ExerciseAboutSheet, { ExerciseAboutContent } from './ExerciseAboutSheet';

// "About this exercise" from anywhere but the Log screen: the exercise picker's search, History's
// and PRs' per-exercise menu, the routine editor's search. It lets someone see what an exercise
// works, and watch how it's done, BEFORE choosing it.
//
// One lookup for every caller: the catalog row by id, from the account-shared exercise catalog
// (cached for offline use like the names), so the muscles and the video are exactly what the Log
// screen's strip would show. Nothing here fetches, and nothing branches on connectivity: an id the
// catalog doesn't hold (a catalog cached before the fields existed, a temp row) answers with the
// name it was given and no muscles, which the sheet already says honestly. The video card has its
// own offline sentence (resilience.md's register).
//
// Read-only on purpose: no "Add muscles worked" here. Muscles are edited in Customize, on the Log
// screen, and a preview is not the place to start an edit. The body-figure choice is the one thing
// it can change, and it is the same per-person preference the Log screen's sheet sets.
function usePreview(exerciseId, fallbackName) {
  const { exercises } = useExercises();
  const { bodyFigure, setBodyFigure } = useAppState();
  const muscleMap = useMuscleMap();
  const row = exercises.find((e) => e.id === exerciseId) ?? null;
  return {
    exerciseName: row?.name ?? fallbackName ?? '',
    muscles: exerciseMuscles(row),
    video: exerciseVideo(row),
    bodyFigure,
    onChooseFigure: setBodyFigure,
    muscleMap,
  };
}

export function ExercisePreviewSheet({ exerciseId, exerciseName, onClose }) {
  const props = usePreview(exerciseId, exerciseName);
  return <ExerciseAboutSheet {...props} onClose={onClose} />;
}

// Shown INSIDE the routine editor's dialog, whose unsaved routine lives in that dialog's state, so
// the muscle highlighter note names Settings without linking there: following the link would leave
// the screen and throw the half-built routine away.
export function ExercisePreviewContent({ exerciseId, exerciseName }) {
  const props = usePreview(exerciseId, exerciseName);
  return <ExerciseAboutContent {...props} settingsLink={false} />;
}
