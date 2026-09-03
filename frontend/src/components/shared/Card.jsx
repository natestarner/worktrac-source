// The app's surface primitive. The recipe it replaces -- surface background, 1px
// --color-border, --radius-lg -- was retyped inline in ~61 places, which is how the radius
// drifted between 8, 10, 12, 14 and 16 for things that are all the same kind of object.
//
// `size` exists because the recipe was only half the problem. Those 61 sites carried **27
// distinct paddings** between them, and only two used this component's own default -- so adopting
// `Card` without a padding scale would have meant 59 call sites passing `style={{ padding: … }}`,
// relocating the drift rather than removing it.
//
// The three steps are measured, not invented. The real clusters were a roomy group at ~18-20px and
// a tight group at ~16px, with everything else an outlier:
//
//   default   --space-5 (20px)   a card you read: settings sections, summary cards, forms
//   dense     16px x 20px       a card that is a LIST, whose rows carry their own rhythm.
//                              Vertical-tight, horizontal-roomy -- NOT 16px all round. That
//                              shape is what the app already does: '16px 20px' is the single
//                              biggest cluster in the codebase (7 sites), with '16px 18px'
//                              and '18px 20px' next. A square 16 would have narrowed the
//                              gutters on every one of them for no reason.
//   flush     0                  the children own their spacing entirely (a .card-row list, a
//                                chart that must bleed to the edge)
//
// A fourth value is an outlier and should look like one -- pass an explicit `style` override and
// the reason, rather than widening this scale back toward 27.
export default function Card({ size = 'default', flush = false, className = '', style, children, as: Tag = 'div', ...rest }) {
  const classes = ['card', flush && 'card-flush', !flush && size === 'dense' && 'card-dense', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} style={style} {...rest}>
      {children}
    </Tag>
  );
}
