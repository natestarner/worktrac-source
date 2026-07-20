// The freshness UX policy made visible: when a view already has cached data on screen but a
// background refresh is in flight, this small pill announces it. An on-screen value therefore
// never changes silently -- the pill appears first, the value updates when the refresh lands, the
// pill clears. It renders nothing on the genuine first load (that's the skeleton's job) or when
// data is fresh (no refetch -> no pill). Callers pass `show={isFetching && !isLoading}`.
export default function RefreshingPill({ show }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        padding: '4px 10px',
        marginBottom: 12,
        borderRadius: 999,
        background: 'var(--color-subtle-bg)',
        color: 'var(--color-muted)',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: '2px solid var(--color-faint)',
          borderTopColor: 'var(--color-muted)',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      Refreshing…
    </div>
  );
}
