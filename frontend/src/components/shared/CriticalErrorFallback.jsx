// Fallback for the two "the app itself may be broken" boundaries -- App.jsx's boot boundary and
// its last-resort boundary around <Routes> (see frontend-core.md's three-boundary table). NOT used
// by AppShell's tab-panel boundary, which is a genuinely different situation: one tab crashed, the
// rest of the app (including a working way to navigate off it) is still on screen, so its own
// "Try again" is already a real fix. Here, by definition, nothing around this fallback is known to
// still work.
//
// Why this exists on top of ErrorBoundary's own default fallback: #202 (2026-08-25) added the boot
// boundary after a "the app painted, then went white, and I had to manually type the login URL"
// report -- but its only recovery action was "Try again", which just clears the boundary's error
// state and re-renders the SAME tree against the SAME (possibly still-poisoned) restored state. For
// a throw rooted in axis D (a persisted slice or cached entry from an earlier build), that reliably
// throws again immediately. The same report recurred on 2026-08-31 for exactly that reason -- the
// only thing that had actually fixed it, per that report, was navigating to /login and signing in
// again fresh (AuthContext's login() calls resetQueryCache() before anything else, which "Try
// again" alone never does).
//
// "Go to login" is therefore the PRIMARY action here, not a last resort found by trial and error --
// and it is a real <a>, not a client-side navigate(). If the thing that threw is upstream of the
// router itself, there may be no router to hand a client-side navigation to; a plain anchor doesn't
// need one to work.
export default function CriticalErrorFallback({ title, retry }) {
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-4)',
        margin: 'var(--space-4) auto',
        maxWidth: 480,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>{title}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-4)' }}>
        Anything you&rsquo;ve logged is still saved on this device and will sync. Nothing is lost.
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href="/login" className="btn btn-primary btn-lg pressable">
          Go to login
        </a>
        <button onClick={retry} className="btn btn-secondary btn-lg pressable">
          Try again
        </button>
      </div>
    </div>
  );
}
