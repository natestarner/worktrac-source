import { highlightMatches } from '../../utils/exerciseSearch';

// Ranked exercise search results, rendered as a traditional single-column list (one result per
// row) rather than the wrapped chip layout used for Favorites/Other Previously Logged -- that
// distinction matters once a query can return many matches, and keeps "pick one of these curated
// exercises" visually separate from "here's what matched your search". Styled after the row list
// in HistoryTab.jsx (card container, rows divided by a bottom border) for consistency with the
// rest of the app.
export default function ExerciseSearchResults({ results, term, onSelect, emptyMessage }) {
  if (results.length === 0) {
    return <div style={emptyStyle}>{emptyMessage}</div>;
  }

  return (
    <div style={cardStyle}>
      {results.map((ex, i) => (
        <button
          key={ex.id}
          onClick={() => onSelect(ex.id)}
          // Splitting the name across sibling <span>s for highlighting makes browsers insert a
          // space at each element boundary when computing the accessible name (e.g. "Cable Fly"
          // -> "Ca ble Fly" for a "ca" query) -- pin it back to the real name explicitly.
          aria-label={ex.name}
          style={{ ...rowStyle, borderBottom: i < results.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}
        >
          {highlightMatches(ex.name, term).map((seg, j) => (
            <span key={j} style={seg.matched ? matchedStyle : undefined}>
              {seg.text}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '4px 20px',
  marginBottom: 20,
};

const rowStyle = {
  display: 'block',
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

const matchedStyle = { fontWeight: 800, color: 'var(--color-accent)' };

const emptyStyle = { textAlign: 'center', padding: '30px 20px', color: 'var(--color-faint)', fontSize: 15 };
