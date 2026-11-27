// The Log tab's exercise search screen has its own route so the browser's Back closes it, the way
// Back leaves any other screen. The screen itself is driven by UIContext's `exerciseSearchOpen`,
// which can change synchronously inside the tap; the route follows it (React Router v7 wraps
// navigation in a transition, which no tap handler can wait for). See LogTab.jsx and
// docs/architecture/exercise-search-history.md.
export const EXERCISE_SEARCH_PATH = '/app/log/search';
export const LOG_PATH = '/app/log';
