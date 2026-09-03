// The first-run guided tour's one data module -- no React import, modelled on
// components/trends/exerciseMetrics.js. ProductTour.jsx is the only consumer that renders any of
// this; everything here is plain data so it can be unit tested without a render (jsdom computes no
// layout, so a render couldn't prove anything about placement anyway -- see tourPosition.js).
//
// Copy rule: every body is a POINTER, never a restatement of a rule the handbook
// (components/help/HelpTab.jsx) owns -- Epley, the 8-hour autoclose, the offline split, the
// duplicate-exercise rule. "The rest clock starts itself" is fine (it points at the handbook's
// rest section); "targets 90 seconds" would not be (that's the handbook's number to state, and a
// second copy of it here is a second place for the two to drift). Keeping the tour purely deictic
// is what stops it needing a row in .claude/rules/user-facing-help.md's "what invalidates the
// handbook" table -- a tour step never states a fact that file's table would need to track.

// The nine `data-tour-anchor` attribute values, one per step, applied at the real DOM elements
// listed in the table below. Exported so every component that carries one imports its value from
// here rather than typing the string twice -- a typo in either place is otherwise a silent
// no-spotlight with no error.
export const TOUR_ANCHORS = {
  LOG_TAB: 'log-tab', // TabsNav.jsx, the Log NavLink
  PEOPLE_BAR: 'people-bar', // PersonPillBar.jsx, the whole .person-pill-bar div
  EXERCISE_SEARCH: 'exercise-search', // ExercisePicker.jsx, the search input
  ADD_EXERCISE: 'add-exercise', // ExercisePicker.jsx, "+ Add your own exercise"
  SET_ENTRY: 'set-entry', // ExerciseDetail.jsx, .stepper-pair
  LOG_SET: 'log-set', // ExerciseDetail.jsx, the primary Log-set Button
  CUSTOMIZE_EXERCISE: 'customize-exercise', // ExerciseDetail.jsx, the Customize IconButton
  NEW_ROUTINE: 'new-routine', // RoutinesTab.jsx, "+ New routine"
  ACCOUNT_MENU: 'account-menu', // UserMenu.jsx, the trigger button
};

// `screen` declares where each step needs the app arranged, applied by ProductTour's one effect
// keyed on stepIndex: navigate if `route` differs from the current pathname; call `backToPicker()`
// for `exercise: 'none'`; call `selectExercise(tourExerciseId)` for `exercise: 'open'`. Declarative
// rather than an imperative switch is what makes stepping BACKWARDS re-arrange for free -- there is
// no separate "undo" path to keep in sync with the forward one.
export const TOUR_STEPS = [
  {
    id: 'log-tab',
    anchor: TOUR_ANCHORS.LOG_TAB,
    title: 'Everything starts on the Log tab',
    body: 'Pick or create an exercise, enter your weight/reps, and log your set.',
    screen: { route: '/app/log', exercise: 'none' },
  },
  {
    id: 'people-bar',
    anchor: TOUR_ANCHORS.PEOPLE_BAR,
    title: 'Everyone on one account',
    body: 'Add everyone in your household here. Tap their name to switch as you work out. Everyone’s numbers stay separate.',
    screen: { route: '/app/log', exercise: 'none' },
  },
  {
    id: 'exercise-search',
    anchor: TOUR_ANCHORS.EXERCISE_SEARCH,
    title: 'Search the whole library',
    body: 'Type here to search for an exercise. Favorite exercises sit below for quick selection.',
    screen: { route: '/app/log', exercise: 'none' },
  },
  {
    id: 'add-exercise',
    anchor: TOUR_ANCHORS.ADD_EXERCISE,
    title: 'Your gym’s odd machine',
    body: 'Can’t find your exercise in the library? Add your own here.',
    screen: { route: '/app/log', exercise: 'none' },
  },
  {
    id: 'set-entry',
    anchor: TOUR_ANCHORS.SET_ENTRY,
    title: 'Weight and reps',
    body: 'These prefill from your last session, so a repeat set is one tap.',
    screen: { route: '/app/log', exercise: 'open' },
  },
  {
    id: 'log-set',
    anchor: TOUR_ANCHORS.LOG_SET,
    title: 'One button per set',
    body: 'This button starts the session, kicks off the rest timer, and saves your set.',
    screen: { route: '/app/log', exercise: 'open' },
  },
  {
    id: 'customize-exercise',
    anchor: TOUR_ANCHORS.CUSTOMIZE_EXERCISE,
    title: 'Make it yours',
    body: 'Notes, tags, and setup numbers (like bar height and seat position) live behind here.',
    screen: { route: '/app/log', exercise: 'open' },
  },
  {
    id: 'new-routine',
    anchor: TOUR_ANCHORS.NEW_ROUTINE,
    title: 'A saved running order',
    body: 'Create a routine so that you don’t need to find the next exercise each time you switch.',
    screen: { route: '/app/routines', exercise: 'none' },
  },
  {
    id: 'account-menu',
    anchor: TOUR_ANCHORS.ACCOUNT_MENU,
    title: 'Settings and help live here',
    body: 'People, units, offline mode, the full handbook and a way to reach us.',
    screen: { route: '/app/log', exercise: 'none' },
  },
];
