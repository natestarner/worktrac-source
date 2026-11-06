# Library exercise videos

Each `library-videos-*.csv` here is a reviewed mapping from a Huddle library exercise to a how-to
video, turned into a Flyway migration by `scripts/video-migration.mjs` (the migration throws on a
name that matches no library exercise). The CSV is the source of truth: to change a video, add a new
CSV and migration; never edit an applied one. Background: `docs/architecture/data-model.md`, "How-to
videos".

## 2026-11-06: 57 of 163 library exercises (`V97`)

**Decided by Nate on 2026-11-06:** go ahead and embed Muscle & Strength's videos. Permission was
asked by email on 2026-11-05, and no reply had come by then. Only ids are stored. Nothing is copied
from their site (text, images, page structure), and the player is YouTube's own embed of a video on
their public channel.

**How the ids were found.** Their demo clips do not show up in YouTube search (they behave as
unlisted), so each id came from the exercise's own page on muscleandstrength.com. Pages were read
in an ordinary browser, one request at a time. Each exercise was matched to their page by name. The
match was made by their directory listing where it had one, otherwise by trying likely page
addresses.

**How each was checked.** Every id was asked of YouTube's oEmbed endpoint: it answered 200
(public, embeddable) and named **Muscle & Strength** as the author. Each YouTube title was then read
against our exercise by hand.

**Left out on purpose** (106):

- **Vimeo instead of YouTube (34).** Their newer clips are on Vimeo with playback restricted to their
  own site ("Because of its privacy settings, this video cannot be played here"; 403 when framed
  from app.huddle.fitness). Among them: Plank, Side Plank, Dumbbell Lateral Raise, Hammer Curl,
  Barbell Curl, EZ-Bar Curl, Cable Curl, Preacher Curl, Seated Cable Row, Pec Deck, Cable Crunch,
  Russian Twist, Tricep Dip, Hanging Leg Raise / Knee Raise, Standing Calf Raise, Leg Curl, Dumbbell
  Step-Up, Dumbbell RDL, Upright Row, Smith Machine Bench and Shoulder Press.
- **No page found (70).** Mostly conditioning and bodyweight moves they don't cover as exercises
  (carries, sled, jumps, crawls, burpees, holds, dead bug, bird dog), and a few lifts under page
  addresses we didn't guess (face pull, goblet squat, kettlebell swing, sumo / trap bar deadlift,
  hip thrust, glute bridge, cleans, snatch, push press, Pendlay row).
- **Judged not close enough (2).** Romanian Deadlift's video is titled "Stiff Leg Deadlift" (M&S
  treats them as one; Huddle's aliases don't), and Cable Chest Fly's is a lying "Supine Cable Fly",
  where Cable Crossover already has their standing one.

The app hides any of these videos YouTube later reports as gone (`ExerciseVideoChecker`, daily).

## 2026-11-06: 22 of the 50 new library exercises (`V101`)

The library expansion (V98) added 50 exercises, each picked because Muscle & Strength has a page for
the same movement. The ids were found and checked exactly as above. 22 have a YouTube clip, all
oEmbed-verified with titles matching. The other 28 are site-locked Vimeo, including all the new
curls, Bench Dip, Tricep Kickback, and the lunges and squats other than Box and Overhead Squat.
One of the 22, Barbell Stiff-Leg Deadlift, reuses the "Stiff Leg Deadlift" clip that was judged
wrong for Romanian Deadlift. Here it names the same lift.

## Adding more

1. Find the video. For Muscle & Strength, the exercise page's YouTube embed; anything else, a channel
   whose terms allow embedding.
2. Check it: `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<id>`
   must answer 200 with the expected author, and the title must name the same movement.
3. Add the rows to a new dated CSV here, then
   `node scripts/video-migration.mjs docs/exercise-videos/<file>.csv <next version> <description>`.
