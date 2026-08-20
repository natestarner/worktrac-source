import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { DEFAULT_REST_TARGET_SECONDS } from '../../utils/restTarget';
import AddPersonModal from '../shared/AddPersonModal';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase();
}

function PersonPill({ person, active, onSelect }) {
  const { session } = useLiveSession(person.id);
  // restTimers is defaulted because it is read during RENDER: a context missing it would throw
  // rather than degrade, and this component renders in the chrome that every screen depends on.
  const { restTimers = {} } = useUI();
  const [restEnabled] = useRestTimerPreference(person.id);
  const isLive = !!session;

  // EVERY person's ring, not just the active one's -- that is the whole point. In a shared
  // household workout the device sits in front of whoever is lifting, so before this the only
  // person who could see a rest timer was the one who didn't need to look it up. The bar at the
  // bottom speaks for the active person; these rings answer "is anyone ELSE ready to go".
  const restTimer = restEnabled ? restTimers[person.id] : null;
  const restTarget = restTimer?.targetSeconds || DEFAULT_REST_TARGET_SECONDS;
  const restProgress = restTimer ? Math.min(1, restTimer.elapsed / restTarget) : 0;
  const restDone = !!restTimer && restTimer.elapsed >= restTarget;

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
      {/* position: relative purely so the ring can hang OUTSIDE this circle without costing any
          layout -- it paints into the padding the pill already has, so a pill does not resize when
          someone starts resting. */}
      <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        {restTimer && (
          <span
            className={`pill-rest-ring${restDone ? ' pill-rest-ring-done' : ''}`}
            role="img"
            aria-label={restDone ? 'Rest ready' : 'Resting'}
            style={{
              '--rest-progress': restProgress,
              // One ring, two grounds: the active pill is solid --color-accent-strong (where the
              // accent arc would be invisible), inactive pills are --color-surface.
              '--rest-ring-fill': active ? 'var(--color-accent-contrast)' : 'var(--color-accent)',
              '--rest-ring-track': active ? 'var(--rest-ring-track-on-accent)' : undefined,
            }}
          />
        )}
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
      </span>
      {person.name}
      {/* The green dot means "this person has an open workout", and the ring above means "this
          person is resting". Neither subsumes the other: someone mid-SET has a session and no ring,
          rest is transient where a session is an hour, and a person whose rest timer is switched
          off never gets a ring at all. The ring is therefore never green -- green on a pill means
          exactly one thing.

          data-testid because three e2e specs used to assert this dot by COUNTING the pill's <span>
          children, which the ring's wrapper would silently break. */}
      {isLive && (
        <span
          data-testid="live-session-dot"
          title="Workout in progress"
          aria-label="Workout in progress"
          role="img"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--radius-full)',
            background: active ? 'var(--color-accent-contrast)' : 'var(--color-success)',
            display: 'inline-block',
            flexShrink: 0,
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
