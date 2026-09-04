import Modal from './Modal';
import IconButton from './IconButton';
import { IconTrash } from './icons';

// Presentational: lists exactly the queued changes it's given, in the order provided (callers pass
// them pre-sorted by enqueue order -- see useOutboxItems.js). Lets someone offline verify nothing
// they logged was lost before they reconnect, rather than trusting OfflineBanner's bare count.
//
// It is also the escape hatch. A queued write that can never land used to have no exit at all --
// the only way out was logging out, which discards the whole outbox and the session with it. So
// every row carries a Discard, and the footer carries a Clear all. Both are destructive and both
// are routed through the caller's confirm (see OfflineBanner's container), never fired on the tap.
//
// Discard is offered on EVERY row, not just the ones marked stuck. Gating the escape hatch on the
// app's own opinion of what is stuck would withhold it in exactly the case nobody predicted, which
// is the case it exists for.
export default function OutboxModal({ items, onDiscard, onClearAll, onClose }) {
  const anyDead = items.some((item) => item.dead);
  return (
    <Modal width={360} onClose={onClose} title={`Waiting to sync (${items.length})`}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-5)' }}>
        These will send automatically once you&rsquo;re back online.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '50vh', overflowY: 'auto' }}>
        {items.length === 0 && (
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-muted)' }}>Nothing queued right now.</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-subtle-bg)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-base)',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 'var(--weight-bold)' }}>
                {item.personName}
                {item.exerciseName ? ` — ${item.exerciseName}` : ''}
              </div>
              <div style={{ color: 'var(--color-muted)' }}>{item.detail}</div>
              {/* Only ever shown for a write that can genuinely never land (isDeadWrite). A write
                  retrying against a down, cold or timing-out backend is NOT this -- it stays
                  pending and reads as waiting to sync, because that is what it is doing. */}
              {item.dead && (
                <div style={{ color: 'var(--color-danger)', fontWeight: 'var(--weight-semibold)' }}>
                  Couldn&rsquo;t sync
                </div>
              )}
            </div>
            {/* The detail rides along in the accessible name so the rows stay distinguishable to a
                screen reader and to a test -- a bare "Discard" repeated N times names nothing.
                Checked against every other control on this screen for the substring rule: the
                header X is "Close", the footer is "Done", and the confirm's pair is
                "Cancel"/"Delete". None contains "Discard" and "Discard" contains none of them. */}
            <IconButton
              onClick={() => onDiscard(item)}
              label={`Discard ${item.exerciseName ? `${item.exerciseName} ` : ''}${item.detail}`}
              icon={IconTrash}
              tone="danger"
            />
          </div>
        ))}
      </div>
      {/* "Done", not "Close": the header's X is labelled "Close", and Playwright matches an
          accessible name as a substring, so two controls named "Close" in one dialog is a
          strict-mode violation. Keep labels on one screen mutually non-containing. */}
      <button
        onClick={onClose}
        className="pressable"
        style={{
          width: '100%',
          minHeight: 44,
          marginTop: 'var(--space-5)',
          padding: 'var(--space-3)',
          background: 'var(--color-subtle-bg)',
          color: 'var(--color-text)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--weight-bold)',
          cursor: 'pointer',
        }}
      >
        Done
      </button>
      {/* Always present once anything is queued, never only when something is already stuck: a
          person going looking for the way out should find it before they have to reproduce the
          failure. De-emphasised to danger TEXT rather than a filled button so it reads as the last
          resort it is, next to a Done that is the ordinary exit. */}
      {items.length > 0 && (
        <button
          onClick={onClearAll}
          className="pressable"
          style={{
            width: '100%',
            minHeight: 44,
            marginTop: 'var(--space-2)',
            padding: 'var(--space-3)',
            background: 'none',
            color: 'var(--color-danger)',
            border: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
          }}
        >
          Clear all queued changes
        </button>
      )}
      {/* Deliberately does NOT repeat the row badge's wording. Both are on screen together, and
          both test layers match text as a substring, so a hint quoting the badge verbatim makes
          every assertion on the badge ambiguous. */}
      {anyDead && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
          A change flagged above won&rsquo;t send on its own. Discarding it lets the rest through.
        </div>
      )}
    </Modal>
  );
}
