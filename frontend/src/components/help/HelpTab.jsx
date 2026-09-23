import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EXERCISE_METRICS } from '../trends/exerciseMetrics';
import { WEEKLY_METRICS } from '../trends/weeklyMetrics';
import { DEFAULT_REST_TARGET_SECONDS, REST_CEILING_SECONDS } from '../../utils/restTarget';
import { useUI } from '../../context/UIContext';
import Button from '../shared/Button';

// The end-user handbook. Invariants + what invalidates them: `.claude/rules/user-facing-help.md`.
//
// This lives INSIDE the app rather than on the marketing site for one reason: it has to work in
// the basement. `huddle.fitness` is a separate origin with no service worker, so a link to it is
// a dead tap at exactly the moment someone is standing at a rack wondering what the green dot
// means. As a route here it rides the app shell's precache (vite.config.js `globPatterns` +
// `navigateFallback`), so it renders with no signal like every other tab.
//
// Eagerly imported, like every other route in App.jsx. React.lazy would trim ~6KB gzipped off the
// initial bundle and introduce the app's only Suspense boundary plus a second route-loading
// mechanism -- against CLAUDE.md's "reuse the existing mechanism" rule, and in an app whose whole
// thesis is offline reliability, a route that fetches a chunk is a strictly worse failure shape
// than one that doesn't.
//
// The per-metric Trends copy is READ FROM the metric tables, never restated -- the same constants
// ChartHelp renders, so the in-app "?" and this page cannot drift apart. chartHelp.test.js already
// asserts every metric carries one. Don't paste that prose in here.

const SECTIONS = [
  { id: 'setup', title: 'Setting up your household', group: 'Getting started' },
  { id: 'people', title: 'Adding and switching people', group: 'Getting started' },
  { id: 'logging', title: 'Logging a set', group: 'During a workout' },
  { id: 'rest', title: 'The rest timer', group: 'During a workout' },
  { id: 'time', title: 'Reps or time', group: 'During a workout' },
  { id: 'own', title: 'Adding your own exercise', group: 'During a workout' },
  { id: 'routines', title: 'Routines', group: 'During a workout' },
  { id: 'history', title: 'History', group: 'Looking back' },
  { id: 'prs', title: 'PRs', group: 'Looking back' },
  { id: 'trends', title: 'Trends', group: 'Looking back' },
  { id: 'personal', title: 'Notes, tags and favorites', group: 'Making it yours' },
  { id: 'settings', title: 'Settings', group: 'Making it yours' },
  { id: 'logins', title: 'Giving someone their own login', group: 'Making it yours' },
  { id: 'visibility', title: 'What the account holder can see', group: 'Making it yours' },
  { id: 'coaching', title: 'Training clients', group: 'Making it yours' },
  { id: 'plan', title: 'Plans', group: 'Making it yours' },
  { id: 'data', title: 'Import and export', group: 'Making it yours' },
  { id: 'offline', title: 'Losing the connection', group: 'When things go wrong' },
  { id: 'trouble', title: 'Getting help', group: 'When things go wrong' },
];

const restCeilingMinutes = REST_CEILING_SECONDS / 60;

export default function HelpTab() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { startTour } = useUI();

  // ARRIVING at /app/help#plan has to land on that section. Nothing else makes it happen, and the
  // section ids are advertised as deep links right above -- so "How Free and Plus differ"
  // (HistoryWindowModal) navigated to the handbook and left the reader at the top of a very long
  // page, twelve thousand pixels above the answer. Measured: scrollY stayed 0 with the target
  // heading at y=12447.
  //
  // Neither entry path can scroll on its own, for different reasons:
  //   full load / reload / bookmark -- the browser looks for #plan before React has rendered it,
  //     finds nothing, and does not retry.
  //   client-side <Link> -- React Router changes the URL and never scrolls at all.
  // Both are a mount of this component, which is why one mount-time effect covers both.
  //
  // This does NOT replace the native jump for the in-page <a href="#plan"> links: those already
  // work (verified -- scrollY 0 -> 12283), and a hash-only anchor click fires `hashchange` rather
  // than `popstate`, so `useLocation` may not even re-run for them. Running twice would be
  // harmless anyway; scrolling to the same element is idempotent.
  //
  // scrollIntoView() honours the `scroll-margin-top: var(--sticky-chrome-clearance)` on
  // .help-section, so the heading clears the sticky chrome exactly as a native jump does -- don't
  // reach for scrollTo(), which would have to re-derive that offset and could then disagree with
  // the CSS.
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.slice(1)) : '';
    if (!id) return;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView();
  }, [hash]);

  return (
    <div className="help">
      <button onClick={() => navigate(-1)} className="pressable" style={backButtonStyle}>
        &larr; Back
      </button>

      <h1 className="help-title">Huddle Handbook</h1>
      <p className="help-standfirst">
        Everything worth knowing about tracking your household&rsquo;s workouts. That includes the
        handful of things that look obvious and aren&rsquo;t.
      </p>

      <div className="help-orient">
        <Orient label="One account" text="The whole household shares a single login." />
        <Orient label="Separate logs" text="Everyone is a profile you tap. Nobody's numbers mix." />
        <Orient label="No start button" text="Logging a set starts the workout for you." />
        <Orient label="Signal optional" text="Logging works with no internet and syncs later." />
      </div>

      {/* Replays the same nine-step tour a brand-new account sees on its first login (see
          components/onboarding/). Not inside a <Section> -- section ids are API
          (/app/help#<id> deep links), pinned as a literal in HelpTab.test.jsx, and this button
          isn't one of them. The tour's own arrange-effect navigates to /app/log for step 1; its
          snapshot is what returns here on finish or skip. */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Button onClick={startTour} variant="secondary" fullWidth>
          Take the tour
        </Button>
      </div>

      <Contents />

      <Section id="setup" title="Setting up your household">
        <p className="help-lede">
          Huddle is built around one household on one screen. You create one account; everyone who
          trains with you becomes a profile on it.
        </p>
        <ol className="help-steps">
          <li>
            Tap <T>Register</T> and enter your name, your email and a password of at least 8
            characters. The household name is optional. Leave it blank and it becomes
            &ldquo;Your Name&rsquo;s Household&rdquo;. Then tap <T>Create household</T>
          </li>
          <li>Check your email for a six-digit code and enter it on the confirmation screen.</li>
          <li>Add the people you train with, and start logging.</li>
        </ol>
        <p>
          That&rsquo;s the whole setup. There is nothing to configure before your first set. Units,
          rest timers and routines all have working defaults, and can wait until you want them.
        </p>

        <h3 className="help-h3">Put it on your home screen</h3>
        <p>
          Huddle is a website, so there is no app store. Open <strong>app.huddle.fitness</strong> in
          your phone or tablet browser and from your browser's settings, tap{' '}
          <T>Add to Home Screen</T>. It then opens full-screen like any other app. Importantly, it
          keeps working when there&rsquo;s no signal.
        </p>
      </Section>

      <Section id="people" title="Adding and switching people">
        <p className="help-lede">
          Your kids don&rsquo;t need their own logins. Everyone is a profile you tap, and each
          profile&rsquo;s data is completely separate from everyone else&rsquo;s.
        </p>
        <p>
          <strong>To add someone:</strong> account menu &rarr; <T>Profile</T> &rarr; <T>People</T>{' '}
          &rarr; <T>Add a person</T>. <ChipWait />
        </p>
        <p>
          <strong>To switch:</strong> tap their name in the bar across the top. That bar only appears
          once there is more than one person on the account.
        </p>

        <h3 className="help-h3">What the dots and rings mean</h3>
        <HelpTable
          head={["On a person's name", 'Means']}
          rows={[
            ['Green dot', 'They have a workout in progress right now.'],
            ['Ring around the name', "Their rest timer is still running. They aren't ready yet."],
            ['Filled ring', "Their rest is up. They're ready to go."],
          ]}
        />
        <p>
          This is the point of the whole design: when three of you are trading off a bar, you can see
          who&rsquo;s ready without asking.
        </p>

        <Note title="Everyone keeps their own place">
          <p>
            Switching to your son and back doesn&rsquo;t disturb anything of yours. Each person keeps
            their own open tab, their own exercise screen, their own half-typed search box and their
            own running rest timer. Timers keep counting in the background while someone else is on
            screen.
          </p>
        </Note>
      </Section>

      <Section id="logging" title="Logging a set">
        <p className="help-lede">
          Two taps: pick the exercise, tap the big button. Everything else on the screen exists to
          save you a decision.
        </p>

        <h3 className="help-h3">Finding the exercise</h3>
        <p>The <T>Log</T> tab opens on your own short list, not the full library:</p>
        <ul>
          <li><strong>Favorites:</strong> the ones you starred.</li>
          <li><strong>Other Previously Logged:</strong> everything else you&rsquo;ve actually done.</li>
        </ul>
        <p>
          Type in the search box to reach the full library. Search is forgiving about word order, so
          &ldquo;barbell squat&rdquo; finds <strong>Barbell Back Squat</strong>. You don&rsquo;t have
          to guess the exact name.
        </p>
        <p>
          Both lists stay alphabetical, and they always will &mdash; so an exercise sits in the same
          place every time you come looking for it. Once a list outgrows the screen it shows the
          first few rows with a <T>Show all</T> link underneath; tap it to see the rest, and{' '}
          <T>Collapse</T> to fold it back. Worth knowing: a wide screen fits more per row, so an
          iPad shows more of the list than a phone before the link appears.
        </p>

        <h3 className="help-h3">Logging</h3>
        <p>
          Open an exercise and you get two steppers, weight and reps, and one big{' '}
          <T>Log set for&hellip;</T> button with the active person&rsquo;s name on it. The steppers
          prefill from what you did last time, so a repeat set really is one tap. Press and hold{' '}
          <T>&minus;</T> or <T>+</T> to run through numbers quickly instead of tapping one at a
          time; how big each tap or hold-step is can be set per person in{' '}
          <T>App Settings</T> &rarr; <T>Steppers</T>.
        </p>
        <p>
          Above them sit two cards: <strong>Last time</strong>, showing that session&rsquo;s sets and
          any note you left, and your <strong>best</strong> for this exercise. Below,{' '}
          <T>This session</T> lists what you&rsquo;ve logged so far, newest at the top, with edit and
          delete on every row.
        </p>

        <Note title="A weight of 0 means bodyweight">
          <p>
            It isn&rsquo;t a blank you forgot to fill in. Pull-ups, push-ups and dips are logged at 0,
            and Huddle treats that as a real value. Those exercises get ranked by reps rather than
            by weight everywhere it matters.
          </p>
        </Note>

        <h3 className="help-h3">Starting and ending a workout</h3>
        <p>
          There is no &ldquo;start workout&rdquo; button. Logging your first set starts the session,
          and a bar appears at the bottom of the screen reading <T>Session in progress</T> with the
          time you began.
        </p>
        <p>
          When you&rsquo;re done, tap <T>End workout</T> in that bar. Logging another set any time
          afterwards simply starts a new one.
        </p>

        <Note title="If you forget to end it">
          <p>
            A session closes itself once eight hours have passed with nothing logged. You won&rsquo;t
            come back tomorrow to find yesterday&rsquo;s workout still open and quietly swallowing
            today&rsquo;s first set.
          </p>
        </Note>

        <h3 className="help-h3">Fixing a mistake</h3>
        <p>
          Every row under <T>This session</T> has edit and delete controls. Corrections flow everywhere
          automatically. Personal records are recomputed from your actual sets, so fixing a
          fat-fingered 225 that should have been 125 also fixes the record it wrongly set.
        </p>
        <p>To fix something from an earlier day, see <Jump to="history">History</Jump>.</p>
      </Section>

      <Section id="rest" title="The rest timer">
        <p className="help-lede">
          It starts on its own when you log a set, and it counts up rather than down.
        </p>
        <p>
          The bar at the bottom fills toward a <strong>{DEFAULT_REST_TARGET_SECONDS}-second target</strong>.
          When it&rsquo;s full, you&rsquo;re ready. Counting up rather than down is deliberate: a full
          bar is a stable &ldquo;go now&rdquo; that holds, and if you sit for four minutes the timer
          says so instead of vanishing at zero. Anything past the target shows as an overrun.
        </p>
        <ul>
          <li>Every person has their own timer, running independently in the background.</li>
          <li>It stops climbing at {restCeilingMinutes} minutes, long past any real rest interval.</li>
          <li>Ending the workout clears that person&rsquo;s timer.</li>
        </ul>
        <p>
          <strong>To turn it off:</strong> account menu &rarr; <T>App Settings</T> &rarr;{' '}
          <T>Rest Timer</T>. Every person on the account gets their own switch, all on one screen.{' '}
          <ChipWait />
        </p>

        <Note title="Turning it off doesn't stop the recording">
          <p>
            Huddle records how long you rested before each set whether or not you&rsquo;re watching a
            timer. The switch only controls whether it&rsquo;s shown.
          </p>
        </Note>
      </Section>

      <Section id="time" title="Reps or time">
        <p className="help-lede">
          Some exercises are counted; some are held. The screen tells you which, and that&rsquo;s the
          entire idea you have to learn.
        </p>
        <p>
          Planks, wall sits, dead hangs and jump rope are measured in <strong>time</strong>. Burpees,
          mountain climbers and air squats are measured in <strong>reps</strong>. The rule behind the
          library: things you count are reps, things you sustain are time.
        </p>
        <p>
          On a timed exercise the second stepper reads <T>Time</T> instead of <T>Reps</T> and shows
          minutes and seconds. The layout, the one big button and the set list are exactly the same.
        </p>

        <h3 className="help-h3">Two ways to fill in the time</h3>
        <ul>
          <li>
            <strong>Hold to the target and tap <T>Log set</T>.</strong> The field prefills with your
            last hold, so beating it is one tap.
          </li>
          <li>
            <strong>Use the built-in timer.</strong> Tap <T>Start timer</T>, hold, then <T>Stop</T>.
            Stopping writes the elapsed seconds into the field. It does not log the set. Tap{' '}
            <T>Log set</T> when you&rsquo;re ready.
          </li>
        </ul>
        <p>
          Tapping the time itself opens a minute/second wheel rather than a keyboard, because a
          keyboard has no colon on it. The timer reads the actual clock, so it stays honest even if
          your screen locks mid-plank.
        </p>

        <Note title="Holds are ranked on seconds alone">
          <p>
            A 60-second plank ties another 60-second plank whether or not you wore a weight vest.
            Added load is kept as a <strong>separate</strong> record, called &ldquo;heaviest load
            held,&rdquo; because combining the two would need your bodyweight, which Huddle
            doesn&rsquo;t store. Put vest weight in the ordinary Weight field; there&rsquo;s no extra
            box for it.
          </p>
        </Note>
      </Section>

      <Section id="own" title="Adding your own exercise">
        <p className="help-lede">
          The library won&rsquo;t have your gym&rsquo;s odd machine, and it doesn&rsquo;t need to.{' '}
          <ChipGo />
        </p>
        <ol className="help-steps">
          <li>
            On the <T>Log</T> tab, tap <T>+ Add your own exercise</T> at the bottom of the picker. If
            you&rsquo;d already typed a name into the search box, it arrives prefilled.
          </li>
          <li>
            Choose whether it&rsquo;s measured in <strong>Reps</strong> or <strong>Time</strong>. This
            decides what the second stepper means every time you use it.
          </li>
          <li>Save. You land straight on the new exercise&rsquo;s screen, ready to log.</li>
        </ol>
        <p>
          Your exercises belong to your household and appear alongside the built-in ones for everyone
          on the account.
        </p>

        <Note title="You can't accidentally end up with two of the same thing">
          <p>
            If an exercise by that name already exists, yours or a built-in one, Huddle
            tells you <strong>before</strong> you commit, then opens the one you already have instead
            of creating a duplicate.
          </p>
          <p>
            The exception is a genuine pair: if you already have a rep-measured Glute Bridge and you
            add a time-measured one, that&rsquo;s a different movement, so it&rsquo;s created as its
            own exercise with a distinguishing name.
          </p>
        </Note>
      </Section>

      <Section id="routines" title="Routines">
        <p className="help-lede">
          A routine is a saved running order of exercises. It&rsquo;s the list, in sequence, so
          you&rsquo;re not hunting through the picker between sets.
        </p>
        <p>
          That&rsquo;s deliberately all it is. A routine does <strong>not</strong> prescribe sets, reps
          or weights, and it doesn&rsquo;t hold you to anything. It answers &ldquo;what&rsquo;s
          next?&rdquo; while your hands are chalky and your phone is on the floor. What you actually
          lift is whatever you log.
        </p>

        <h3 className="help-h3">Building one</h3>
        <p>
          <T>Routines</T> tab &rarr; <T>+ New routine</T>. Name it (Push Day, Legs, Warm-up) and add
          exercises from your library in the order you&rsquo;ll do them. An exercise
          can appear more than once; each position is its own step, so a routine that opens and closes
          with the same movement works fine. <ChipWait />
        </p>

        <h3 className="help-h3">Putting them in order</h3>
        <p>
          Your routines are listed in whatever order you put them in, on the <T>Routines</T> tab and
          in the Log picker&rsquo;s shortcut alike. Tap <T>Reorder routines</T>, drag the handles,
          then tap <T>Done</T>. <ChipWait />
        </p>
        <p>
          This is worth two minutes if you have more than a handful: the Log picker&rsquo;s{' '}
          <T>Start a routine</T> shortcut only shows the first four, so the ones you put at the top
          are the ones waiting for you when you walk in.
        </p>

        <h3 className="help-h3">Running one</h3>
        <p>
          Start it from the <T>Routines</T> tab, or from the <T>Start a routine</T> shortcut at the top
          of the Log picker. <ChipGo />
        </p>
        <p>
          A card appears at the top of the Log tab with the routine&rsquo;s name, your position
          (&ldquo;3 of 6&rdquo;), and a strip of pills, with the current exercise highlighted and
          finished ones green. Tap <T>Next exercise</T> to advance; on the final step the button reads{' '}
          <T>Finish routine</T>. Tap any pill to jump straight to that exercise.
        </p>

        <h3 className="help-h3">Going off-script</h3>
        <ul>
          <li>
            <strong>Something else came up.</strong> Back out to the picker and log any exercise you
            like. Your routine position is untouched. Carry on where you left off.
          </li>
          <li>
            <strong>Cutting it short.</strong> Tap <T>End routine</T>. Nothing you logged is affected;
            the routine chrome just disappears and you stay exactly where you are.
          </li>
          <li><strong>The machine was taken.</strong> Tap a later pill, do that one, then tap back.</li>
        </ul>
        <p>
          A running routine survives closing the app or reloading the page. It resumes at the
          same position.
        </p>

        <h3 className="help-h3">Sharing one with someone else</h3>
        <p>
          Tap <T>Copy to&hellip;</T> on any routine to give another person their own copy. It&rsquo;s
          independent from that moment on: they can reorder or delete theirs without touching yours.{' '}
          <ChipWait />
        </p>
      </Section>

      <Section id="history" title="History">
        <p className="help-lede">History answers one question: what did I do on this day?</p>
        <p>
          Workouts are listed newest first, each with its date, its time (or a start&ndash;end range),
          every exercise and every set. Personal records are badged where they happened, and the
          badge says which kind: a trophy for your best single effort, a double chevron for a top
          weight. On a bodyweight exercise the trophy means most reps, and on a hold it means longest
          hold &mdash; the badge names whichever it is. A whole-workout record sits next to the
          exercise name rather than on one set, because no single set is the answer to
          &ldquo;most volume&rdquo;. A small key above the list repeats what each shape means. See{' '}
          <a href="#prs">PRs</a> for what each one means.
        </p>
        <p>
          <strong>Records look the same everywhere.</strong> The same shapes, in the same single
          colour, mark a record on the Log tab while you are still lifting &mdash; on the set you
          just logged, and beside the exercise in <T>Session exercises</T> &mdash; and here
          afterwards. A record marks the set that <em>beat</em> your previous best, so matching your
          best again is not marked a second time.
        </p>
        <p>
          On <T>Free</T> this shows the last 90 days. Everything before that is still saved in your
          full history. See <a href="#plan">Free and Plus</a>.
        </p>

        <h3 className="help-h3">Finding something</h3>
        <ul>
          <li><strong>Search</strong> by exercise name.</li>
          <li><strong>Tag chips</strong> narrow the list to a category you&rsquo;ve defined.</li>
          <li>
            <strong>Tap an exercise name</strong> inside a workout to choose whether to filter
            down to just that exercise or jump to its progress chart in Trends.
          </li>
        </ul>

        <h3 className="help-h3">Fixing an old workout</h3>
        <p>
          Tap <T>Edit</T> on a session and it reopens on the Log tab in editing mode, with a date and
          time field at the top. Add a set you forgot, correct a number, or fix the timestamp. Tap{' '}
          <T>Done</T> when finished.
        </p>

        <h3 className="help-h3">Logging something you did days ago</h3>
        <p>
          <T>+ Log a past workout</T> creates a session on a date you choose, so you can backfill a
          workout you did away from your phone. <ChipWait />
        </p>

        <Note title="Backfilled sets have no rest times">
          <p>
            Huddle records rest between sets by watching the clock while you actually train. A workout
            typed in afterwards, or a set added to an old session, honestly has no rest
            time to record, so it&rsquo;s left blank rather than invented. It has no effect on your
            records or your volume.
          </p>
        </Note>

        <p>
          <T>Export data</T> at the top of the tab downloads this person&rsquo;s complete history as a
          CSV. <ChipWait />
        </p>
      </Section>

      <Section id="prs" title="PRs">
        <p className="help-lede">Your best for every exercise you&rsquo;ve done, on one board.</p>
        <p>
          Records are recomputed from your actual logged sets rather than stored when they happen.
          So correcting a wrong entry corrects the record, and deleting a set that
          shouldn&rsquo;t have counted removes it from the board.
        </p>
        <p>
          On <T>Free</T> the board covers the last 90 days; <T>Plus</T> makes it all-time. Either
          way, a set is only badged as a PR if it beats <strong>everything</strong> you have logged.
          See <a href="#plan">Free and Plus</a>.
        </p>
        <p>
          <T>Record</T> chooses which best the board is showing &mdash; the same five measures the
          Trends progress chart plots. Three of them measure a <strong>single best set</strong>; two
          are <strong>session totals</strong>:
        </p>
        <HelpTable
          head={['Record', 'What it shows']}
          rows={Object.values(EXERCISE_METRICS).map((m) => [m.label, m.recordMeaning])}
        />
        <p>
          A <strong>dash</strong> means the record doesn&rsquo;t apply to that exercise: a pull-up has
          no top weight, a plank has no reps. Those rows drop to the bottom when you sort by the
          record, and stay in place under the other two sorts.
        </p>
        <p>
          <T>Sort</T> orders the board: <strong>Most recent</strong> (the default: what got better
          lately), <strong>Name A&ndash;Z</strong>, or best-first on whichever record you picked.
          Tap a row and you can jump to that exercise in History or to its progress chart in Trends.
          The same search and tag filters from History work here too.
        </p>

        <Note title="Not everything is ranked the same way">
          <p>Comparing sets fairly depends on what the exercise is, so Huddle uses three different rules:</p>
          <ul>
            <li><strong>A loaded lift</strong> is ranked by estimated 1RM, which combines weight and reps.</li>
            <li>
              <strong>A bodyweight exercise</strong> has no weight to estimate from, so it&rsquo;s
              ranked by reps. That&rsquo;s why those rows show a rep count rather than a weight.
            </li>
            <li><strong>A hold</strong> is ranked by seconds.</li>
          </ul>
        </Note>

        <h3 className="help-h3">What gets celebrated, and when</h3>
        <p>
          Break a record while you&rsquo;re logging and Huddle says so on the spot, with a
          full-screen burst you dismiss when you&rsquo;re ready &mdash; it won&rsquo;t vanish on a
          timer while you&rsquo;re mid-conversation. Three records trigger it:
        </p>
        <ul>
          <li>
            <strong>Est. 1RM</strong> &mdash; your best single effort. On a bodyweight exercise this
            is your rep count, and on a hold it&rsquo;s your time.
          </li>
          <li>
            <strong>Top weight</strong> &mdash; the heaviest you&rsquo;ve ever loaded this exercise.
            It&rsquo;s the one record nothing can inflate: you have to actually lift more. A
            bodyweight exercise has no weight to beat, so it never fires there; a{' '}
            <em>weighted</em> hold does have one, and gets it.
          </li>
          <li>
            <strong>Volume</strong> &mdash; the most total work you&rsquo;ve ever done of one
            exercise in a single workout. This one fires once per workout, on the set that passes
            your old record, not again on every set after it. Volume is weight &times; reps added
            up; on a bodyweight exercise it&rsquo;s your total reps, and on a hold your total time.
            Your first workout of an exercise sets the baseline, so volume can only be beaten from
            your second workout on.
          </li>
        </ul>
        <p>
          Take more than one at once and you get a single celebration listing all of them, not a
          queue of pop-ups. Each type has its own icon and colour, and the same icons mark the sets
          in History so you can tell at a glance which kind of record each one was.
        </p>
        <p>
          The <strong>first set of a brand-new exercise</strong> is treated as a starting point
          rather than a record. It still appears in History as your best &mdash; it is &mdash; but
          there&rsquo;s nothing to beat yet, so it gets a quieter welcome.
        </p>
        <p>
          <strong>This all works with no signal.</strong> Records are worked out on your device from
          what it already knows, so a PR in a basement gym is celebrated the moment you log it,
          exactly as it would be at home. Nothing waits on the server.
        </p>
        <p>
          While you&rsquo;re logging, if the numbers on screen are within a rep or two of your best,
          a small line above the button tells you how close you are.
        </p>

        <h3 className="help-h3">Two numbers that disagree on purpose</h3>
        <p>
          On an exercise screen you may see both a <strong>heaviest weight</strong> and a{' '}
          <strong>best estimated 1RM</strong>, and they often name different sets. 185&nbsp;lb for 8
          estimates to about 234&nbsp;lb and outranks a 225&nbsp;lb single. One is the most you have
          lifted; the other is the most the estimate thinks you could. Both are worth knowing, so both
          are shown, and the estimate always names the set behind it.
        </p>

        <Note title="How the estimate is calculated">
          <p>Huddle uses <strong>Epley&rsquo;s formula</strong>, the most common one in strength training:</p>
          <p className="help-formula">estimated 1RM = weight &times; (1 + reps &divide; 30)</p>
          <p>
            So 185&nbsp;lb for 8 reps gives 185 &times; (1 + 8/30) = <strong>234.3&nbsp;lb</strong>. A
            single rep is already a one-rep max, so a set of 1 is reported as the weight itself rather
            than being inflated by the formula.
          </p>
          <p>
            <strong>Only the first 12 reps of a set count towards the estimate.</strong> Every 1RM
            formula drifts optimistic at high rep counts &mdash; uncapped, 135&nbsp;lb for 30 reps
            would estimate to 270&nbsp;lb and out-rank a genuine 225&nbsp;lb triple. So a set of 20
            is scored as if it were a set of 12. Doing more reps never lowers your estimate; past 12
            it simply stops raising it, and the extra work still counts towards your volume and rep
            records.
          </p>
          <p>
            It&rsquo;s an estimate, not a measurement. Other apps and calculators may use Brzycki or
            Lombardi instead and give a different number for the same set. None of them is wrong.
            They simply disagree. What matters is that Huddle applies one formula consistently, so
            your numbers are always comparable to your own past numbers.
          </p>
          <p>
            Two sets never go through it at all: a <strong>bodyweight</strong> set, because Epley
            multiplies the weight and any weight of 0 stays 0 no matter the reps, so those rank on
            reps instead. And a <strong>hold</strong> has no rep count to estimate from, and ranks
            on seconds.
          </p>
        </Note>
      </Section>

      <Section id="trends" title="Trends">
        <p className="help-lede">
          History tells you about a day and PRs tell you about a lifetime. Trends is the shape in
          between.
        </p>
        <p>
          The <strong>4wk / 12wk / All</strong> buttons at the top set the range for the charts. Every
          chart also carries a <strong>?</strong> that explains its own marks in plain English. Tap
          it whenever a chart surprises you.
        </p>

        <h3 className="help-h3">The consistency grid</h3>
        <p>
          One square per day; the darker the square, the more sets you logged. Tap a square for that
          day&rsquo;s totals.
        </p>
        <Note title="The grid ignores the range buttons">
          <p>
            It always shows the last six months, whatever range is selected. Four weeks would be four
            columns wide and look broken; five years would be unreadable on a phone. The shading also
            uses fixed thresholds rather than scaling to your own history, so a dark square means the
            same thing for you in March as it does for your son in August.
          </p>
          <p>
            On <T>Free</T> the grid still spans six months, but only the last 90 days can be filled
            in. That is as far back as Free shows. See <a href="#plan">Free and Plus</a>.
          </p>
        </Note>

        <h3 className="help-h3">Weekly totals</h3>
        <p>
          One bar per week, starting Monday. Switch between four measures of that week:
        </p>
        <HelpTable
          head={['Metric', 'Each bar is']}
          rows={Object.values(WEEKLY_METRICS).map((m) => [m.label, m.barMeaning])}
        />

        <h3 className="help-h3">Per-exercise progress</h3>
        <p>
          Pick an exercise and choose what to plot. Three of the five measure a{' '}
          <strong>single best set</strong>; two are <strong>session totals</strong>. Reading one as the
          other will quietly mislead you about your own training, so the labels are worth knowing:
        </p>
        <HelpTable
          head={['Metric', 'Each dot is']}
          rows={Object.values(EXERCISE_METRICS).map((m) => [m.label, m.dotMeaning])}
        />

        <Note title="Three things about this chart that catch people out">
          <ul>
            <li>
              <strong>A dot is one workout, not one day.</strong> Two sessions on a Tuesday put two
              dots on the same date label.
            </li>
            <li>
              <strong>A green dot is a personal record</strong>, judged by the rules in the{' '}
              <Jump to="prs">PRs</Jump> section, whatever metric you&rsquo;re currently viewing. So a
              green dot is not always the highest point on the chart in front of you.
            </li>
            <li>
              <strong>Dots are spaced evenly.</strong> The gap between two of them shows how many
              workouts apart they were, not how much time passed.
            </li>
            <li>
              <strong>Some of the five disappear for a bodyweight exercise.</strong> Top weight and
              Best set are always zero with no added weight, so they&rsquo;re hidden rather than
              shown as flat lines at 0. Est. 1RM, Volume and Reps stay &mdash; Est. 1RM falls back
              to your rep count when there&rsquo;s no weight to estimate from, and Volume becomes
              your total reps.
            </li>
          </ul>
        </Note>
        <p>
          Below the chart, <T>All-time bests</T> lists this exercise&rsquo;s records, and{' '}
          <T>Exercise history</T> jumps to every workout it appears in, filtered for you in History.
        </p>
      </Section>

      <Section id="personal" title="Notes, tags and favorites">
        <p className="help-lede">
          Five ways to make an exercise yours. All of them are per person. Your setup for the
          leg press has nothing to do with your son&rsquo;s.
        </p>
        <p>
          The star and note icons sit at the top of any exercise screen; the rest live behind the{' '}
          <T>&hellip;</T> button beside them.
        </p>
        <HelpTable
          head={['What', 'Does', 'Offline?']}
          rows={[
            ['Favorite', 'Pins the exercise to the top of your Log picker.', <ChipGo key="f" short />],
            [
              'Session note',
              'Attached to this one workout. Shows up on the “Last time” card next session, and in History.',
              <ChipGo key="s" short />,
            ],
            [
              'Standing note',
              'A permanent reminder shown every time you do this exercise: “keep elbows tucked”, “bad knee, go light”.',
              <ChipWait key="n" short />,
            ],
            [
              'Tags',
              'Your own categories: Push, Pull, Legs, Rehab. Filter History and PRs by them.',
              <ChipWait key="t" short />,
            ],
            [
              'Setup fields',
              'Numbers you’d otherwise re-find every time: seat height, pin position, bench angle. Each person stores their own value for the same field.',
              <ChipWait key="c" short />,
            ],
          ]}
        />
        <p>
          Setup values appear as small pills on the exercise screen (<strong>Seat height: 4</strong>)
          and tapping one changes it. To clear any note, save it empty.
        </p>
      </Section>

      <Section id="settings" title="Settings">
        <p className="help-lede">
          Account menu &rarr; <T>App Settings</T>. There isn&rsquo;t much here, on purpose.
        </p>
        <HelpTable
          head={['Setting', 'What it does']}
          rows={[
            ['Units', 'Sets lb or kg for sets you log from now on.'],
            ['Offline Mode', 'Pins the app offline on this device.'],
            ['Rest Timer', 'An on/off switch per person, all on one screen.'],
            ['Steppers', 'How far one tap of −/+ moves weight and time, per person.'],
            ['Tags', 'Create and delete the categories you tag exercises with.'],
            ['Data', 'Export everything, import a file, and undo a past import.'],
          ]}
        />
        <Note title="Changing units never rewrites your history">
          <p>
            Sets already logged keep the unit they were recorded in. Switching to kg won&rsquo;t
            reinterpret last year&rsquo;s numbers as kilos. It only affects what you enter next.
          </p>
        </Note>
        <p>
          The <T>Profile</T> screen holds your account details, the list of people, and account
          deletion. Deleting an account is permanent, so export your data first. The
          confirmation dialog offers exactly that. It also asks you to type <T>DELETE</T> and to
          enter your password, so a device someone left signed in can&rsquo;t erase the household.
        </p>
      </Section>

      {/* ⚠️ THIS SECTION IS A PROMISE, NOT A DESCRIPTION.
          Three sentences here are load-bearing and are asserted in code elsewhere:
            "Their workouts stay"        -> MembershipInviteService.revoke deletes a membership,
                                            never a person and never training data.
            "You can't see or set their
             password"                   -> there is no CHANGE_ANY_PASSWORD permission, deliberately.
            "They can't change anyone
             else's workouts"            -> AccountRole never grants MEMBER WRITE_OTHER_PEOPLE,
                                            under any visibility setting.
          If any of those ever stops being true, this copy changes in the same commit. */}
      <Section id="logins" title="Giving someone their own login">
        <p className="help-lede">
          Everyone in the household can share one login and tap between people &mdash; that is the
          iPad-at-the-squat-rack setup, and it still works exactly as it always did. But an older
          kid with their own phone can have their own sign-in instead.
        </p>
        <p>
          <T>Profile</T> &rarr; <T>Logins</T>, then <T>Enable login</T> next to their name. You
          enter their email address and they get a link. If that address is new to Huddle they
          choose a password; if they already use Huddle they sign in with the password they
          already have, and this household is added to their account alongside their own. Until
          they accept, their row says <T>Invited</T>. This is a Plus feature.
        </p>
        <p>
          Either way, <strong>the invitation only does anything once they act on it</strong>. The
          link on its own is not a way into anybody&rsquo;s account &mdash; someone who already has
          a Huddle password still has to enter it &mdash; and you see the same <T>Invited</T> row
          whichever of the two it turns out to be.
        </p>

        <HelpTable
          head={['They can', 'They cannot']}
          rows={[
            ['Log their own workouts, on their own phone', "Change anyone else's workouts"],
            ['See everyone in the household', 'Add or remove people'],
            ['Add an exercise or tag to the shared list, or delete their own unused tag', 'Delete a shared exercise, or a tag someone else added or uses'],
            ['Rename an exercise they added, until someone else logs it', 'Rename one somebody else added'],
            ['Rename their own name and rest timer', 'Change the household name or units'],
            ['Change their own password', 'Import, export everything, or see billing'],
          ]}
        />

        <Note title="You can never see or set their password">
          <p>
            Not by design and not by accident &mdash; there is no screen anywhere in Huddle that
            lets one person set another&rsquo;s password. If they forget it they use
            <T>Forgot password</T>, exactly as you would. What you can do is send the invite again,
            unlock them if too many wrong tries locked them out, or remove their login.
          </p>
        </Note>

        <Note title="Removing a login keeps the person and everything they logged">
          <p>
            <T>Remove</T> takes away their ability to sign in. It does not delete them, their
            workouts, their history or their PRs &mdash; all of that stays in the household and you
            keep seeing it, exactly as before they had a login.
          </p>
          <p>
            One thing to know: if their phone is offline when you remove them, anything they logged
            and haven&rsquo;t synced yet may never arrive. There is no way around that &mdash; their
            phone can&rsquo;t be reached. If it matters, wait until they&rsquo;re back on a
            connection.
          </p>
        </Note>

        <Note title="If a household goes back to Free">
          <p>
            Member logins pause. Nobody is deleted and nothing is lost &mdash; their workouts and
            everyone else&rsquo;s stay exactly where they are, and the household keeps working from
            the main login. Go back to Plus and their sign-in starts working again on its own.
          </p>
        </Note>

        <Note title="Setting one up for a child">
          <p>
            A login needs an email address, which means a child&rsquo;s login involves collecting
            their email and a password from them. If they&rsquo;re under 13, set it up together with
            a parent or guardian and use an address one of you can reach. You stay in control
            either way: only you can create a login, and only you can remove one.
          </p>
        </Note>
      </Section>

      {/* The other side of the login section above: that one is written for whoever hands a login
          out, and this one for whoever receives it.

          ⚠️ THE PASSWORD SENTENCE IS THE SAME SENTENCE the Profile screen, the invitation email
          and the privacy policy carry. It is a promise, not a description, and it is true because
          there is no CHANGE_ANY_PASSWORD permission and no screen anywhere that sets somebody
          else's password. If that ever changes, all four change in the same commit
          (.claude/rules/member-access.md). */}
      <Section id="visibility" title="What the account holder can see">
        <p className="help-lede">
          If somebody gave you a login on their account &mdash; a parent, or a trainer &mdash; this
          is exactly what they can and cannot do. It is short on purpose.
        </p>

        <HelpTable
          head={['', 'Them', 'You']}
          rows={[
            ['See your workouts, sets and PRs', 'Yes', 'Yes'],
            ['Add, edit or delete your workouts', 'Yes', 'Yes'],
            ['See other people on the account', 'Yes', 'Only if the account is set up that way'],
            ['Remove your login', 'Yes', 'No'],
            ['See or set your password', 'No', 'Yes — it is yours'],
            ['Export your full history', 'Yes', 'Yes, any time, at no cost'],
          ]}
        />

        <Note title="They cannot see or set your password">
          <p>
            There is no screen anywhere in Huddle that lets one person set another&rsquo;s
            password &mdash; not the account holder, not us. If you forget it, you reset it
            yourself from the sign-in screen using your own email.
          </p>
          <p>
            They <em>can</em> clear a lockout if you have typed a wrong password too many times.
            That only lets you try again; it tells them nothing and lets them in as nobody.
          </p>
        </Note>

        <Note title="Your training data lives in their account">
          <p>
            That is worth knowing plainly: if they delete the account, your workouts go with it, and
            we cannot get them back. <strong>You can export your complete history to a CSV file at
            any time, on any plan, without asking them.</strong> It is on the History screen.
          </p>
          <p>
            If your login is removed, your workouts stay in their account &mdash; removing a login
            does not delete a person or their training.
          </p>
        </Note>

        <Note title="Whether other people can see you">
          <p>
            On a family account, everyone on it can see everyone else. On a trainer&rsquo;s account
            it usually works the other way: each client sees only their own training, and only the
            trainer and their assistants see everyone. The account holder chooses which, for the
            whole account.
          </p>
        </Note>
      </Section>

      {/* Written for the TRAINER, unlike #visibility immediately above it, which is written for
          the person who receives a login. The two answer opposite halves of the same arrangement
          and deliberately overlap on the privacy claim -- a client reading one and a trainer
          reading the other must not come away with different accounts of who sees what. */}
      <Section id="coaching" title="Training clients">
        <p className="help-lede">
          On <strong>Huddle Pro</strong> an account is a practice rather than a household. Your
          clients each get their own login, they cannot see each other, and three screens exist
          that a family account never shows.
        </p>

        <HelpTable
          head={['', 'What it is for']}
          rows={[
            ['Clients', 'Everyone you train, sorted so whoever has gone quietest is at the top'],
            ['Check-ins', 'A weigh-in or a note about one client, on the day it happened'],
            ['Targets on a routine', 'The weight and reps you want hit, carried to the client'],
          ]}
        />

        <p>
          <T>Clients</T> and <T>Check-ins</T> are both in your account menu, under your name. A
          client sees <T>Check-ins</T> too &mdash; it is how they log a weigh-in &mdash; but never
          <T>Clients</T>.
        </p>

        <Note title="Assigning a program is just copying a routine">
          <p>
            Build the routine on yourself, then use <T>Copy to&hellip;</T> and pick as many clients
            as you like. It lands on their Routines tab labelled <em>From you</em>, and from that
            moment it is <strong>their</strong> copy &mdash; changing yours afterwards does not
            change theirs, so a tweak you make for one client&rsquo;s knee stays made.
          </p>
          <p>
            Each exercise row takes an optional weight and reps. Those travel with the copy and
            show on the client&rsquo;s log screen as <em>Target 185 lb &times; 5</em>, above the
            card telling them what they did last time. Either half can be left blank &mdash;
            &ldquo;135 lb, as many as you get&rdquo; is a real prescription.
          </p>
        </Note>

        <Note title="A target is a prescription, not a limit">
          <p>
            It never fills in the boxes your client logs from, and nothing stops them going over or
            under it. Beating a target is a good day, and Huddle treats it as one.
          </p>
        </Note>

        <Note title="Notes your client cannot see">
          <p>
            When you write a check-in about a client, <T>Keep this to myself</T> keeps it off their
            screen entirely. They see everything you leave unticked, plus their own entries. A
            client writing their own check-in has no such box &mdash; nobody hides something from
            themselves.
          </p>
        </Note>

        <Note title="Who has stopped showing up">
          <p>
            The <T>Clients</T> screen puts anyone who has <strong>never</strong> logged a workout at
            the very top, ahead of everyone who has simply been away a while. That is deliberate:
            the client who quietly never started is the one easiest to lose and hardest to notice.
          </p>
        </Note>

        <Note title="Assistants">
          <p>
            An assistant can see and log for every client, exactly as you can, and runs the roster.
            They cannot touch billing, delete the account, change account settings, or export the
            whole practice in one go. If you need somebody to cover sessions, that is the role.
          </p>
          <p>
            An assistant who trains here too takes one of your client places, the same as anybody
            else you add. Your own training is the only one that doesn&rsquo;t.
          </p>
        </Note>

        <Note title="If a client leaves you">
          <p>
            Removing their login leaves their training in your account &mdash; you keep the record
            of the work you did together. They can <strong>export their complete history at any
            time, at no cost</strong>, and take the file with them. Importing it into an account of
            their own needs a paid plan on their side, which is worth telling them plainly rather
            than promising a free landing spot.
          </p>
        </Note>
      </Section>

      {/* ⚠️ The section id stays "plan". Section ids are API: HistoryWindowModal deep-links this
          one, and HelpTab.test.jsx pins the whole list as a literal precisely so a rename cannot
          pass by agreeing with itself. Only the title moved from "Free and Plus" to "Plans". */}
      <Section id="plan" title="Plans">
        <p className="help-lede">
          Free is free for good. Not a trial that runs out. Plus adds your whole history, the
          ability to bring old workouts in, and a personal login for anyone who wants one. Pro is
          for personal trainers &mdash; it adds clients who can&rsquo;t see each other, assigned
          programs and a roster.
        </p>

        <HelpTable
          head={['', 'Free', 'Plus', 'Pro']}
          rows={[
            ['People in your household', 'Everyone', 'Everyone', 'You, plus the client places you pay for'],
            ['Workouts, sets and exercises', 'Unlimited', 'Unlimited', 'Unlimited'],
            ['Logging with no signal', 'Yes', 'Yes', 'Yes'],
            ['PRs, routines, rest timer', 'Yes', 'Yes', 'Yes'],
            ['Export all your data', 'Yes', 'Yes', 'Yes'],
            ['History, PRs and trends', 'Last 90 days', 'Everything', 'Everything'],
            ['Import past workouts', 'No', 'Yes', 'Yes'],
            ['A personal login for each person', 'No', 'Yes', 'Yes'],
            ['Keep everyone\u2019s training private from each other', 'No', 'No', 'Yes'],
            ['Assistants who can see everyone', 'No', 'No', 'Yes'],
          ]}
        />

        <Note title="Pro is priced by how many clients you have">
          <p>
            Free and Plus have no seats &mdash; add as many people as your household has. Pro is
            different: you pay by how many <strong>clients</strong> you carry, in bands. Your own
            training is free; everyone else you add takes a place, assistants included.
          </p>
          <p>
            Going over your band never locks anyone out. It stops you adding the{' '}
            <em>next</em> client until you move up a band; everyone already there keeps working
            exactly as before.
          </p>
        </Note>

        <Note title="Nothing you log is ever deleted">
          <p>
            On Free, History, PRs and Trends <strong>show the last 90 days</strong>. Everything
            older is still saved &mdash; every set stays exactly where it was, and the moment you
            subscribe your whole history is on screen again. If you later cancel, you keep Plus until
            the period you paid for ends, and then those screens go back to 90 days.{' '}
            <strong>Your history never changes; only how much of it is on screen does.</strong>
          </p>
          <p>
            You don&rsquo;t have to keep track of this yourself. Whenever your full history holds
            more than History, PRs or Trends is showing, that screen says so and tells you how many
            workouts &mdash; tap <T>About your full history</T> there for the details.
          </p>
        </Note>

        <h3 className="help-h3">Personal records still know the truth</h3>
        <p>
          A record is measured against <strong>everything you have ever logged</strong>, not just
          what Free can show. So on Free you won&rsquo;t be congratulated for beating a 90-day best
          that isn&rsquo;t really your best. If the app says it&rsquo;s a PR, it is one.
        </p>

        <h3 className="help-h3">Getting your data out is always free</h3>
        <p>
          Export works on both plans, always. Your workouts are yours, and taking them with you is
          not something you should ever have to pay for.
        </p>

        <h3 className="help-h3">Changing your plan</h3>
        <p>
          Your account menu &rarr; <T>Plan &amp; billing</T> shows what you&rsquo;re on. Plus is
          $3.99 a month or $29 a year. Payments are handled by Stripe. The app never sees
          your card. <T>Manage billing</T> opens Stripe in a new tab to change a card, download
          receipts, switch between monthly and yearly, or cancel.
        </p>
        <p>Changing your plan needs a connection.</p>
      </Section>

      <Section id="data" title="Import and export">
        <p className="help-lede">
          Your workouts are yours. They go out as an ordinary spreadsheet and come back in the same
          shape.
        </p>

        <h3 className="help-h3">Getting your data out</h3>
        <ul>
          <li><T>History</T> &rarr; <T>Export data</T>: a CSV for the person you&rsquo;re viewing.</li>
          <li>
            <T>App Settings</T> &rarr; <T>Export all data</T>: every person on the account, one
            file each, zipped together.
          </li>
        </ul>
        <p>
          Both need a connection. <strong>Exporting is free on both plans</strong>. Getting
          your own data out is never something you have to pay for.
        </p>

        <h3 className="help-h3">Bringing data in</h3>
        <p>
          <T>App Settings</T> &rarr; <T>Import data</T> takes a CSV or Excel file: one Huddle
          exported, or a spreadsheet you kept yourself. You choose whose workouts it is, and you see
          exactly what will be added before anything is saved. Importing is part of{' '}
          <T>Plus</T> (see <a href="#plan">Free and Plus</a>).
        </p>
        <p>Three columns are required:</p>
        <HelpTable
          head={['Column', "Why it's required"]}
          rows={[
            ['Exercise', "There's nothing to log the set against without it."],
            ['Date', 'Places the set in time.'],
            [
              'Reps or Duration (sec)',
              'One or the other, depending on whether the exercise is counted or held.',
            ],
          ]}
        />
        <p>
          Everything else is optional and falls back to a stated default: <strong>Weight</strong>{' '}
          becomes 0 (bodyweight), <strong>Unit</strong> becomes your account default,{' '}
          <strong>Time</strong> becomes midday, and without a <strong>Session Start</strong> column{' '}
          <strong>everything you did on one date is treated as one workout</strong>. Columns are
          matched by name, so their order in the file doesn&rsquo;t matter.
        </p>
        <p>
          Every default that actually got used is listed in the preview before you commit. You
          find out from the screen, not from a surprise in your history afterwards.
        </p>

        <Note title="Nothing here is a one-way door">
          <ul>
            <li>
              <strong>Re-importing the same file does nothing.</strong> Huddle compares each row
              against what you already have, so a second import of the same export has nothing to add.
            </li>
            <li>
              <strong>An import can be undone.</strong> <T>App Settings</T> &rarr;{' '}
              <T>Recent imports</T> &rarr; <T>Undo</T> removes exactly what that file added and puts
              History back as it was.
            </li>
          </ul>
        </Note>
      </Section>

      <Section id="offline" title="Losing the connection">
        <p className="help-lede">
          Basement gyms, thick walls, dead cellular. Huddle is built so that a bad signal is a normal
          condition rather than a failure.
        </p>
        <p>
          Everything you do in the middle of a workout is saved to your device first and synced
          afterwards, in order, without ever logging anything twice. Setup tasks (the ones you
          do sitting on the couch, not mid-set) wait for a connection and say so plainly.
        </p>

        <div className="help-split">
          <div>
            <div className="help-split-head"><ChipGo /></div>
            <ul>
              <li>Logging, editing and deleting sets</li>
              <li>Starting and ending a workout</li>
              <li>Session notes</li>
              <li>Favoriting</li>
              <li>Creating your own exercise</li>
              <li>Running a routine</li>
              <li>Reading History, PRs and routines</li>
              <li>Searching the exercise library</li>
            </ul>
          </div>
          <div>
            <div className="help-split-head"><ChipWait /></div>
            <ul>
              <li>Adding or editing a person</li>
              <li>Creating, editing, copying or deleting a routine</li>
              <li>Standing notes, tags and setup fields</li>
              <li>Renaming or deleting an exercise</li>
              <li>Changing units or the rest-timer setting</li>
              <li>Logging a past workout</li>
              <li>Import and export</li>
              <li>Changing your plan or managing billing</li>
              <li>Deleting your account</li>
            </ul>
          </div>
        </div>

        <h3 className="help-h3">What you&rsquo;ll see</h3>
        <p>
          A banner tells you you&rsquo;re offline and counts what&rsquo;s waiting: &ldquo;3
          changes waiting to sync&rdquo;. Sets you log while offline appear in your list immediately
          and can be edited and deleted like any other; they aren&rsquo;t stuck behind a spinner. When
          the connection returns, everything sends in the order you did it.
        </p>
        <p>
          Tapping that count opens the full list, so you can check nothing you entered was lost. A
          change that genuinely can&rsquo;t be sent &mdash; a correction to a set you later deleted
          on another device, say &mdash; is marked <T>Couldn&rsquo;t sync</T> rather than sitting
          there looking like it&rsquo;s still trying. A slow or unreachable server never gets that
          mark: those keep retrying for as long as it takes, and they will send.
        </p>
        <p>
          Every row has a <T>Discard</T>, and there&rsquo;s a <T>Clear all queued changes</T> at the
          bottom. You shouldn&rsquo;t need either &mdash; the queue sends on its own &mdash; but
          they&rsquo;re there so a change you no longer want, or one you believe is stuck, is never
          something you have to log out to get rid of. Both ask before discarding anything, and what
          they discard is gone for good.
        </p>

        <h3 className="help-h3">When the signal is bad rather than absent</h3>
        <p>
          The worst case isn&rsquo;t no signal. It&rsquo;s a connection that claims to work and
          doesn&rsquo;t. After a few failed attempts Huddle notices and offers a <T>Go offline</T>{' '}
          button. Taking it stops the app fighting a dead connection and switches it into the same
          reliable save-locally mode.
        </p>
        <p>
          That choice sticks until you undo it, from the banner&rsquo;s <T>Go back online</T> or from{' '}
          <T>App Settings</T> &rarr; <T>Offline Mode</T>. Huddle checks the server is genuinely
          reachable before it starts syncing again. You can also turn it on ahead of time if you
          already know where you&rsquo;re heading.
        </p>

        <Note title="One thing that does lose data: logging out">
          <p>
            If you log out while changes are still waiting to sync, those changes are discarded.
            A different household might sign in on this device next, so they can&rsquo;t be carried
            over. Huddle warns you and tells you how many are at stake. Get back in range and let it
            sync first.
          </p>
          <p>
            Being signed out automatically is different: that keeps your queued changes and sends them
            once you sign back in.
          </p>
        </Note>
      </Section>

      <Section id="trouble" title="Getting help">
        <h3 className="help-h3">Quick answers</h3>
        <HelpTable
          head={['Problem', 'Try this']}
          rows={[
            [
              'A set went to the wrong person',
              'Delete it from “This session”, switch people, log it again.',
            ],
            [
              "An exercise isn't in the picker",
              "The picker shows only what you've favorited or logged. Search for it. The full library is behind the search box.",
            ],
            [
              'Yesterday’s workout is still in progress',
              'It closes itself eight hours after the last set. To close it now, tap “End workout”.',
            ],
            [
              'A PR looks wrong',
              'Records come from your logged sets. Find the bad set in History, fix or delete it, and the record follows.',
            ],
            [
              "A chart isn't saying what you expect",
              'Tap the ? on that chart. It explains what one mark actually represents.',
            ],
            [
              'A button is greyed out',
              "You're offline and it's one of the setup actions. Its tooltip says which.",
            ],
            [
              'Forgotten password',
              '“Forgot password” on the login screen emails you a reset code.',
            ],
            [
              'Too many wrong passwords',
              'Sign-in locks for about 15 minutes. It lifts on its own, or use “Forgot password”, which gets you straight back in.',
            ],
            [
              'The app shows an error instead of loading',
              'Tap “Go to login” and sign back in. Nothing you logged is lost; it is saved on the device and syncs once you are back in. Afterward, Contact Us can send along what went wrong automatically.',
            ],
          ]}
        />

        <h3 className="help-h3">Reporting something</h3>
        <p>
          Account menu &rarr; <T>Contact Us</T>. The form shows you exactly what it sends along with
          your message: which screen you were on, whether you were online, whether anything was
          waiting to sync, and &mdash; if the app ever failed to start &mdash; what it recorded
          about that. So there are no surprises.
        </p>
        <p>
          You can write a report while offline; it&rsquo;s kept safely on your device, and you send it
          once you&rsquo;re back in range.
        </p>
      </Section>
    </div>
  );
}

// --- pieces -----------------------------------------------------------------

// Below this width the contents list is three columns of links stacked into one, and it costs
// ~655px -- pushing the first actual section to y=1430 on an 844px phone, i.e. nearly two screens
// of table of contents before a word of content. So it collapses on a phone and stays open on a
// tablet or desktop, where three columns fit and hiding it would only add a tap.
const WIDE = '(min-width: 880px)';

// jsdom implements no matchMedia, and the summary is display:none at >=880px anyway -- so the
// honest fallback is "open". An expanded contents is never broken, only tall; a collapsed one with
// its toggle hidden would be unreachable. Same defensive shape as the scrollIntoView guards
// elsewhere in the app.
function startsOpen() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(WIDE).matches;
}

function Contents() {
  const [open, setOpen] = useState(startsOpen);

  // Follow the viewport across a rotation or a resize, rather than freezing whatever was true at
  // mount. Turning an iPad to landscape crosses this breakpoint.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(WIDE);
    const apply = (e) => setOpen(e.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const groups = [];
  for (const section of SECTIONS) {
    const last = groups[groups.length - 1];
    if (last && last.name === section.group) last.items.push(section);
    else groups.push({ name: section.group, items: [section] });
  }

  return (
    // `open` is controlled, so onToggle has to mirror the browser's own native toggle back into
    // state or the next media change would fight whatever the person last tapped.
    <details id="contents" className="help-contents-wrap" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="help-contents-summary pressable">Jump to a section</summary>
      <nav className="help-contents" aria-label="Handbook contents">
        {groups.map((group) => (
          <div key={group.name} className="help-contents-group">
            <div className="help-contents-label">{group.name}</div>
            {group.items.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="help-contents-link pressable">
                {section.title}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </details>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="help-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="help-h2">
        {title}
      </h2>
      {children}
      {/* The way back, and deliberately not a floating "back to top" pill: that would be a second
          position:fixed bottom element, and SessionBar already owns that space -- see
          .claude/rules/frontend-core.md, "one box, never a stack of fixed siblings". It also
          stands in for in-page search, which the installed PWA has no browser Find to fall back
          on (the manifest declares display:standalone). Section titles here are intent-shaped
          rather than keyword-shaped, so browsing back to the list beats querying it. */}
      <a href="#contents" className="help-back pressable">
        &uarr; Contents
      </a>
    </section>
  );
}

function Orient({ label, text }) {
  return (
    <div className="help-orient-cell">
      <div className="help-orient-label">{label}</div>
      <div>{text}</div>
    </div>
  );
}

function Note({ title, children }) {
  return (
    <div className="help-note">
      <div className="help-note-title">{title}</div>
      {children}
    </div>
  );
}

// The app's vocabulary, set apart from the prose around it so a control's name reads as a control.
function T({ children }) {
  return <span className="help-term">{children}</span>;
}

// Anchor navigation inside this one page -- a plain href, not a router Link: there is no route
// change here, only a hash, and letting the browser own it keeps back/forward behaving normally.
function Jump({ to, children }) {
  return (
    <a href={`#${to}`} className="help-inline-link">
      {children}
    </a>
  );
}

// `short` is for table cells, where the column header already says "Offline?" and the full
// sentence would wrap every row.
function ChipGo({ short = false }) {
  return <span className="help-chip help-chip-go">{short ? 'Yes' : 'Works offline'}</span>;
}

function ChipWait({ short = false }) {
  return <span className="help-chip help-chip-wait">{short ? 'No' : 'Needs a connection'}</span>;
}

function HelpTable({ head, rows }) {
  return (
    <div className="help-table-wrap">
      <table className="help-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])}>
              {/* Index keys are correct here: a row's cells are a fixed-length tuple that is
                  never reordered, inserted into, or filtered. */}
              {row.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  padding: 0,
  marginBottom: 'var(--space-4)',
};
