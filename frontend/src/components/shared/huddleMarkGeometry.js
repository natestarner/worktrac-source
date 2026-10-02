// The four circles of the Huddle mark, in the mark's own coordinate space -- the same numbers the
// lockup SVGs in assets/ draw inside their mark group. Every drawing of the mark reads them from
// here: HuddleMark (static, translated into its own viewBox) and AnimatedLockup (the login
// screen's walk-in). Two copies of a logo's geometry drift; AnimatedLockup.test.jsx pins this list
// to the asset file so a re-export that moves a circle fails loudly instead of silently.
//
// Listed in paint order. The fills are the mark's fixed identity colours -- never recolour them,
// and never swap cream for a surface token (see HuddleMark's header for why).
export const MARK_CIRCLES = [
  { id: 'orange', cx: 34, cy: 36, r: 34, fill: '#E8734A' },
  { id: 'amber', cx: 92, cy: 29, r: 29, fill: '#F2A65A' },
  { id: 'cream', cx: 32, cy: 82, r: 25, fill: '#F2EDE1' },
  { id: 'rust', cx: 84, cy: 80, r: 19, fill: '#B5542D' },
];
