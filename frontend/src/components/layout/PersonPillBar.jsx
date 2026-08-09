import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import AddPersonModal from '../shared/AddPersonModal';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase();
}

function PersonPill({ person, active, onSelect }) {
  const { session } = useLiveSession(person.id);
  const isLive = !!session;

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className="pressable"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        minHeight: 44,
        padding: 'var(--space-2) var(--space-4) var(--space-2) var(--space-2)',
        borderRadius: 'var(--radius-full)',
        border: `1px solid ${active ? 'var(--color-accent-strong)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-accent-strong)' : 'var(--color-surface)',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-semibold)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--radius-full)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-bold)',
          background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-subtle-bg)',
          color: active ? 'var(--color-accent-contrast)' : 'var(--color-muted)',
        }}
      >
        {initials(person.name)}
      </span>
      {person.name}
      {isLive && (
        <span
          title="Workout in progress"
          aria-label="Workout in progress"
          role="img"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--radius-full)',
            background: active ? 'var(--color-accent-contrast)' : 'var(--color-success)',
            display: 'inline-block',
          }}
        />
      )}
    </button>
  );
}

export default function PersonPillBar() {
  const { people } = useAuth();
  const { activePersonId, selectPerson } = useAppState();
  const [showAddPerson, setShowAddPerson] = useState(false);

  return (
    <>
      <div
        className="person-pill-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          overflowX: 'auto',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {people.map((p) => (
          <PersonPill key={p.id} person={p} active={p.id === activePersonId} onSelect={() => selectPerson(p.id)} />
        ))}
        <OfflineDisabledWrap message="Adding a person needs a connection.">
          {/* The literal "+ " stays. It was tempting to swap it for the IconPlus glyph
              along with the emoji elsewhere, but a text plus is a standard button
              convention that renders identically on every platform and inherits colour
              and weight -- it was never part of the emoji problem. Swapping it would
              also change this button's accessible name, which 17 e2e specs select by. */}
          <button
            onClick={() => setShowAddPerson(true)}
            className="pressable pressable-subtle"
            style={{
              flexShrink: 0,
              minHeight: 44,
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-full)',
              border: '1px dashed var(--color-faint)',
              background: 'none',
              color: 'var(--color-muted)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add person
          </button>
        </OfflineDisabledWrap>
      </div>
      {showAddPerson && <AddPersonModal onClose={() => setShowAddPerson(false)} />}
    </>
  );
}
