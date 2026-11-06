import { useId } from 'react';
import { highlightMatches, matchReason } from '../../utils/exerciseSearch';
import IconButton from './IconButton';
import { IconInfo } from './icons';

// Ranked exercise search results, rendered as a traditional single-column list (one result per
// row) rather than the wrapped chip layout used for Favorites/Other Previously Logged -- that
// distinction matters once a query can return many matches, and keeps "pick one of these curated
// exercises" visually separate from "here's what matched your search". Styled after the row list
// in HistoryTab.jsx (card container, rows divided by a bottom border) for consistency with the
// rest of the app.
// A result found by another name or by the muscle it works (utils/exerciseSearch.js) says so on a
// second line, since nothing in its name is highlighted. That line is not part of the accessible
// name, which stays the exercise's name exactly.
//
// `onPreview` (optional) adds a "Preview exercise" button at the end of each row, which opens the
// exercise's muscles and how-to video (components/exercise/ExercisePreview.jsx) without choosing
// it. ⚠️ Its accessible name must NOT contain the exercise's name: specs click a result by
// `getByRole('button', { name: 'Barbell Bench Press' })`, and Playwright matches names by
// substring, so "Preview Barbell Bench Press" would make every one of those ambiguous. The
// exercise is named to a screen reader through `aria-describedby` instead.
export default function ExerciseSearchResults({ results, term, onSelect, onPreview = null, emptyMessage }) {
  const idPrefix = useId();
  if (results.length === 0) {
    return <div style={emptyStyle}>{emptyMessage}</div>;
  }

  return (
    <div style={cardStyle}>
      {results.map((ex, i) => (
        <div
          key={ex.id}
          style={{ ...rowWrapStyle, borderBottom: i < results.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}
        >
          <button
            id={`${idPrefix}-${ex.id}`}
            onClick={() => onSelect(ex.id)}
            // Splitting the name across sibling <span>s for highlighting makes browsers insert a
            // space at each element boundary when computing the accessible name (e.g. "Cable Fly"
            // -> "Ca ble Fly" for a "ca" query) -- pin it back to the real name explicitly.
            aria-label={ex.name}
            style={rowStyle}
          >
            {highlightMatches(ex.name, term).map((seg, j) => (
              <span key={j} style={seg.matched ? matchedStyle : undefined}>
                {seg.text}
              </span>
            ))}
            <MatchReason ex={ex} term={term} />
          </button>
          {onPreview && (
            <IconButton
              icon={IconInfo}
              label="Preview exercise"
              aria-describedby={`${idPrefix}-${ex.id}`}
              onClick={() => onPreview(ex)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function MatchReason({ ex, term }) {
  const reason = matchReason(ex, term);
  return reason ? <span style={reasonStyle}>{reason}</span> : null;
}

const reasonStyle = {
  display: 'block',
  marginTop: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-normal)',
  color: 'var(--color-muted)',
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '4px 20px',
  marginBottom: 20,
};

const rowWrapStyle = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' };

const rowStyle = {
  display: 'block',
  flex: 1,
  minWidth: 0,
  width: '100%',
  textAlign: 'left',
  padding: '14px 0',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--color-text)',
  cursor: 'pointer',
};

const matchedStyle = { fontWeight: 'var(--weight-bold)', color: 'var(--color-accent-text)' };

const emptyStyle = { textAlign: 'center', padding: 'var(--space-8) var(--space-5)', color: 'var(--color-muted)', fontSize: 'var(--text-base)' };
