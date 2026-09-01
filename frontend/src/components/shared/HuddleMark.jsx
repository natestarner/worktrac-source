// The four-circle cluster from the Huddle mark (assets/huddle-lockup-*.svg) -- literally a huddle
// of people.
//
// Redrawn inline rather than using the SVG asset file, so the one value that legitimately varies
// -- the hairline around the cream circle -- can read this app's own per-scheme token instead of
// the asset's hardcoded light/dark pair. All four fills are the mark's fixed identity colours
// (the same literals the asset files use): a logo keeps its own colours regardless of theme,
// exactly as the wordmark beside it never re-inks itself.
//
// Cream is one of those four. It used to be var(--color-surface) so the circle would blend into
// whatever card it sat on, which was close enough to cream in light mode but rendered a
// near-BLACK hole in dark mode -- the brand sheet's "never alter these four" says otherwise, and
// on a dark ground the cream circle is exactly the element that reads. It is a literal now.
//
// Extracted here when the billing screen needed the same mark. One copy, because two would drift
// -- and a logo drifting between two screens of the same app is the kind of thing nobody notices
// until it looks broken.
//
// hairline overrides that one theme-aware value for the one caller whose ground does NOT follow
// the theme. The default, --brand-mark-hairline, is #bdb6af on light and `transparent` on dark,
// because the cream circle is ~1.1:1 on a white surface (it needs an outline to exist at all) and
// high-contrast on a dark one (the brand sheet drops the outline there). That switch is keyed to
// the GROUND, not to the user's setting -- and PlanBadge's Pro pill keeps a fixed light background
// in BOTH schemes (see .plan-badge--pro's comment), so inheriting the per-scheme token would erase
// its hairline in dark mode and dissolve the circle into the pill. It passes the light value
// explicitly. Every other caller sits on a theme-following surface and leaves this alone.
//
// strokeWidth 1 + vectorEffect keeps the hairline at one device pixel at every size, which is the
// brand sheet's own clamp ("below ~114px the 1.5pt hairline is clamped to 1 device px so it stays
// visible"). At size=14 a scaled 1.5 resolves to ~0.16px -- invisible, which is what the Pro
// pill's mark used to render.
export default function HuddleMark({ size = 128, hairline = 'var(--brand-mark-hairline)' }) {
  // The artwork's own aspect ratio, from the viewBox below. Callers pass one number and cannot
  // accidentally squash it.
  const height = Math.round((size * 115) / 129);

  return (
    <svg width={size} height={height} viewBox="162 135 129 115" aria-hidden="true" focusable="false">
      <circle cx="200" cy="175" r="34" fill="#E8734A" />
      <circle cx="258" cy="168" r="29" fill="#F2A65A" />
      <circle
        cx="198"
        cy="221"
        r="25"
        fill="#F2EDE1"
        stroke={hairline}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="250" cy="219" r="19" fill="#B5542D" />
    </svg>
  );
}
