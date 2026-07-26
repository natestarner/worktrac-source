import Modal from './Modal';

// Presentational: lists exactly the queued changes it's given, in the order provided (callers pass
// them pre-sorted by enqueue order -- see useOutboxItems.js). Lets someone offline verify nothing
// they logged was lost before they reconnect, rather than trusting OfflineBanner's bare count.
export default function OutboxModal({ items, onClose }) {
  return (
    <Modal width={360} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Waiting to sync ({items.length})</div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 18 }}>
        These will send automatically once you&rsquo;re back online.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
        {items.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--color-faint)' }}>Nothing queued right now.</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '10px 14px',
              background: 'var(--color-subtle-bg)',
              borderRadius: 10,
              fontSize: 14,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {item.personName}
              {item.exerciseName ? ` — ${item.exerciseName}` : ''}
            </div>
            <div style={{ color: 'var(--color-muted)' }}>{item.detail}</div>
          </div>
        ))}
      </div>
      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: 18,
          padding: 12,
          background: 'var(--color-subtle-bg)',
          color: 'var(--color-text)',
          border: 'none',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </Modal>
  );
}
