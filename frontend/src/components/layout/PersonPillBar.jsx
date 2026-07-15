import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import AddPersonModal from '../shared/AddPersonModal';

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase();
}

function PersonPill({ person, active, onSelect }) {
  const { session } = useLiveSession(person.id);
  const isLive = !!session;

  return (
    <button
      onClick={onSelect}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px 8px 8px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 800,
          background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-subtle-bg)',
          color: active ? '#fff' : 'var(--color-muted)',
        }}
      >
        {initials(person.name)}
      </span>
      {person.name}
      {isLive && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: active ? '#fff' : 'var(--color-success)',
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
          gap: 8,
          overflowX: 'auto',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          ...(people.length >= 2 ? { position: 'sticky', top: 0, zIndex: 5 } : null),
        }}
      >
        {people.map((p) => (
          <PersonPill key={p.id} person={p} active={p.id === activePersonId} onSelect={() => selectPerson(p.id)} />
        ))}
        <button
          onClick={() => setShowAddPerson(true)}
          style={{
            flexShrink: 0,
            padding: '10px 16px',
            borderRadius: 999,
            border: '1px dashed var(--color-faint)',
            background: 'none',
            color: 'var(--color-muted)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          + Add person
        </button>
      </div>
      {/* Rendered outside the sticky pill bar above: position:sticky + z-index there
          creates a stacking context that would trap this fixed-position modal behind
          later siblings (TabsNav, tab content) regardless of its own z-index. */}
      {showAddPerson && <AddPersonModal onClose={() => setShowAddPerson(false)} />}
    </>
  );
}
