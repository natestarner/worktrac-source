// Generic overlay shell reused by every modal (Add Person, Add/Edit Exercise, Routine
// form, Past Session, Edit Set, Setup Field Editor, End Workout Confirm). `onScrim`
// closes on backdrop tap; pass null to make the modal non-dismissable that way.
export default function Modal({ width = 320, onScrim, children, align = 'center' }) {
  return (
    <div
      onClick={onScrim}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28,27,25,0.4)',
        display: 'flex',
        alignItems: align === 'bottom' ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 20,
        padding: align === 'bottom' ? 0 : 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          // In light mode the dimmed scrim is far lighter than --color-surface, so the modal
          // edge reads clearly without help. In dark mode --color-surface is close enough to
          // the scrim-darkened backdrop that the two become indistinguishable -- the same
          // border every card elsewhere already uses fixes it in both themes at once.
          border: '1px solid var(--color-border)',
          borderRadius: align === 'bottom' ? '20px 20px 0 0' : 20,
          padding: 28,
          width,
          maxWidth: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
