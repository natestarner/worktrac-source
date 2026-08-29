// The four-circle cluster from the Huddle mark (assets/huddle-lockup-*.svg) -- literally a huddle
// of people.
//
// Redrawn inline rather than using the SVG asset file, so the two colours that need to differ by
// theme -- the near-white circle, and the hairline keeping it readable against a light surface --
// can use this app's actual tokens instead of the asset's own hardcoded light/dark pair. The three
// brand-accent circles are the mark's fixed identity colours, not tokens (the same literals the
// asset files use): a logo keeps its own colours regardless of theme, exactly as the wordmark
// beside it never re-inks itself.
//
// Extracted here when the billing screen needed the same mark. One copy, because two would drift
// -- and a logo drifting between two screens of the same app is the kind of thing nobody notices
// until it looks broken.
//
// paleFill/paleStroke override that one theme-aware circle for the one caller that deliberately
// does NOT sit on the app's own surface: PlanBadge's Pro pill keeps a fixed bright background
// regardless of theme (see its own comment for why), so the circle's default --color-surface/
// --color-border would pull in dark mode's DARK surface and DARK border -- meant to blend into a
// dark card, not to sit on a pill that stays light on purpose. Every other caller leaves these at
// their defaults and gets exactly the previous behaviour.
export default function HuddleMark({ size = 128, paleFill = 'var(--color-surface)', paleStroke = 'var(--color-border)' }) {
  // The artwork's own aspect ratio, from the viewBox below. Callers pass one number and cannot
  // accidentally squash it.
  const height = Math.round((size * 115) / 129);

  return (
    <svg width={size} height={height} viewBox="162 135 129 115" aria-hidden="true" focusable="false">
      <circle cx="200" cy="175" r="34" fill="#D4673E" />
      <circle cx="258" cy="168" r="29" fill="#F2A65A" />
      <circle cx="198" cy="221" r="25" fill={paleFill} stroke={paleStroke} strokeWidth="1.5" />
      <circle cx="250" cy="219" r="19" fill="#B5542D" />
    </svg>
  );
}
