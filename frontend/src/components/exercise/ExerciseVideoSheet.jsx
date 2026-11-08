import Modal from '../shared/Modal';
import ExerciseVideoCard from './ExerciseVideoCard';

// The how-to video on its own, opened by the play button at the end of the Log screen's strip
// (ExerciseAboutStrip). The strip's Vitruvian Man opens the muscles (ExerciseAboutSheet); each icon
// opens only what it shows (decided 2026-11-08). Same sheet shape as the muscles' one, titled with
// the exercise's name.
//
// Nothing here fetches until "Play the video" is tapped (ExerciseVideoCard), and closing the sheet
// unmounts the player, which is what stops the video. The card's offline sentence is its one
// connectivity branch (resilience.md's register).
//
// With no video, the strip shows play struck through and this sheet says so instead of the
// player: videos come with Huddle's library exercises, so one of your own never has one, and a
// library exercise may not have one YET. Not a connectivity branch: `video` comes from the cached
// catalog, so the same exercise says the same thing in every mode.
export default function ExerciseVideoSheet({ exerciseName, video, ownExercise = false, onClose }) {
  return (
    <Modal align="bottom" width={560} title={exerciseName} onClose={onClose} initialFocus="dialog">
      {video ? (
        <ExerciseVideoCard video={video} exerciseName={exerciseName} />
      ) : (
        <p className="exercise-video-none">
          {ownExercise
            ? 'How-to videos come with exercises from Huddle’s library. This one is your own, so it doesn’t have one.'
            : 'There’s no how-to video for this exercise yet.'}
        </p>
      )}
    </Modal>
  );
}
