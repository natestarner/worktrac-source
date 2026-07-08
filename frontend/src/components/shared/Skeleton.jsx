// A placeholder block shaped like the content that will eventually occupy this space,
// with a shimmering sweep to read as "loading" rather than "empty". Compose these into
// view-specific shapes (a card outline, a row, a chip) instead of a single generic spinner
// -- keeps layout stable and gives a rough preview of what's coming.
export default function Skeleton({ width = '100%', height = 14, radius = 6, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(100deg, var(--skeleton-base) 30%, var(--skeleton-highlight) 50%, var(--skeleton-base) 70%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
