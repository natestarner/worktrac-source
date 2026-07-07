import { endWorkout } from '../../api/sessions';
import Modal from './Modal';
import { cancelButtonStyle, deleteButtonStyle } from './ConfirmDialog';

export default function EndWorkoutConfirmModal({ personId, onClose, onEnded }) {
  async function handleEnd() {
    await endWorkout(personId);
    onEnded();
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>End this workout?</div>
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 20 }}>
        You can keep going any time &mdash; logging another set later will simply start a new workout.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <button onClick={handleEnd} style={deleteButtonStyle}>
          End workout
        </button>
      </div>
    </Modal>
  );
}
