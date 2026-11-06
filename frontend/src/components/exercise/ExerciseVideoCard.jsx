import { useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { externalLinkProps } from '../../lib/native';
import { embedSrc, watchUrl } from '../../utils/exerciseVideo';
import { IconPlay } from '../shared/icons';
import SectionLabel from '../shared/SectionLabel';

// The how-to video, inside "About this exercise" (ExerciseAboutSheet). Library exercises only:
// `video` comes from the catalog (utils/exerciseVideo.js), and null renders nothing.
//
// Nothing is fetched until the play button is tapped -- no poster image, no YouTube request -- so
// opening the sheet costs no data and leaves nothing broken behind on a weak signal. The tap loads
// this app's own embed page (public/embed/youtube.html), which frames YouTube muted and playing;
// YouTube's controls unmute it. Closing the sheet unmounts the frame, which stops the video.
//
// ⚠️ ONE CONNECTIVITY BRANCH, and it is on resilience.md's register: with no connection the play
// button is replaced by "The video needs a connection." The player is YouTube's own page, so
// offline there is nothing to show but its error screen, and a play button that leads there reads
// as broken. useOnlineStatus (never lie-fi) is the deliberate signal: under lie-fi YouTube itself
// may still answer, so the button stays. The attribution and the YouTube link are shown either way.
export default function ExerciseVideoCard({ video, exerciseName }) {
  const online = useOnlineStatus();
  const [playing, setPlaying] = useState(false);
  if (!video) return null;

  return (
    <section className="exercise-video" aria-label="How-to video">
      <SectionLabel as="h3">How to do it</SectionLabel>
      <div className="exercise-video-frame">
        {!online ? (
          <p className="exercise-video-offline">The video needs a connection.</p>
        ) : playing ? (
          <iframe
            src={embedSrc(video)}
            title={`How-to video: ${exerciseName}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="exercise-video-play pressable" onClick={() => setPlaying(true)}>
            <span className="exercise-video-play-icon">
              <IconPlay size={28} />
            </span>
            Play the video
          </button>
        )}
      </div>
      <p className="exercise-video-credit">
        Video: {video.sourceLabel} on YouTube.{' '}
        <a {...externalLinkProps(watchUrl(video), { leaveApp: true })}>Open on YouTube</a>
      </p>
    </section>
  );
}
