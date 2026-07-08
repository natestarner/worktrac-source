import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { useRoutines } from '../../hooks/useRoutines';
import { removeRoutine } from '../../api/routines';
import RoutineFormModal from './RoutineFormModal';
import Skeleton from '../shared/Skeleton';

export default function RoutinesTab() {
  const navigate = useNavigate();
  const { activePersonId, startRoutine } = useAppState();
  const { openConfirm } = useUI();
  const { exercises } = useExercises();
  const { routines, loading, refetch } = useRoutines(activePersonId);
  const [modalRoutine, setModalRoutine] = useState(undefined); // undefined = closed, null = create, object = edit

  function handleStart(routine) {
    startRoutine(routine.id, routine.exercises.map((e) => e.exerciseId));
    navigate('/app/log');
  }

  async function handleDelete(routine) {
    await removeRoutine(activePersonId, routine.id);
    refetch();
  }

  return (
    <div>
      <button onClick={() => setModalRoutine(null)} style={newRoutineButtonStyle}>
        + New routine
      </button>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Skeleton width={140} height={16} />
                <div style={{ display: 'flex', gap: 14 }}>
                  <Skeleton width={28} height={13} />
                  <Skeleton width={44} height={13} />
                </div>
              </div>
              <Skeleton width={200} height={13} style={{ marginBottom: 14 }} />
              <Skeleton width={144} height={41} radius={10} />
            </div>
          ))}
        </div>
      )}

      {!loading && routines.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
          No routines yet. Build one from your exercise library.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!loading && routines.map((r) => (
          <div key={r.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{r.name}</div>
              <div style={{ display: 'flex', gap: 14 }}>
                <button onClick={() => setModalRoutine(r)} style={editLinkStyle}>
                  Edit
                </button>
                <button
                  onClick={() => openConfirm(`Delete "${r.name}"? This can't be undone.`, () => handleDelete(r))}
                  style={deleteLinkStyle}
                >
                  Delete
                </button>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>
              {r.exercises.map((e) => e.exerciseName).join(', ')}
            </div>
            <button onClick={() => handleStart(r)} style={startButtonStyle}>
              Start workout
            </button>
          </div>
        ))}
      </div>

      {modalRoutine !== undefined && (
        <RoutineFormModal
          personId={activePersonId}
          routine={modalRoutine}
          exercises={exercises}
          onClose={() => setModalRoutine(undefined)}
          onSaved={() => {
            setModalRoutine(undefined);
            refetch();
          }}
        />
      )}
    </div>
  );
}

const newRoutineButtonStyle = {
  width: '100%',
  padding: 16,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  marginBottom: 16,
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const startButtonStyle = {
  padding: '12px 20px',
  background: 'var(--color-accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};
