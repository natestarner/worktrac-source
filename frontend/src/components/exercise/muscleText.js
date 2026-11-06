import { muscleName } from '../../utils/muscles';

function joinNames(codes) {
  return codes.map(muscleName).filter(Boolean);
}

// "Chest, Triceps" -- the strip's visible line. Primary muscles only: that is what a glance needs,
// and on a phone there is not room for more (the sheet lists both).
export function primaryLine({ primary }) {
  return joinNames(primary).join(', ');
}

function sentenceList(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The strip button's accessible name. The visible text is hidden on narrow screens, so the label
// carries the muscles itself. Starts with "About this exercise", which no other control on the Log
// screen contains and which contains none of theirs (Playwright matches names by substring).
export function aboutLabel({ primary, secondary }) {
  const main = joinNames(primary);
  const helpers = joinNames(secondary);
  if (main.length === 0) return 'About this exercise';
  const helperPart = helpers.length > 0 ? `, helped by ${sentenceList(helpers)}` : '';
  return `About this exercise: works ${sentenceList(main)}${helperPart}`;
}
