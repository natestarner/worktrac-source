// The app's surface primitive. The recipe it replaces -- surface background, 1px
// --color-border, 16px radius -- was retyped inline in ~25 places, which is how the
// radius drifted between 8, 12, 14 and 16 for things that are all the same kind of
// object.
//
// `flush` drops the padding for cards whose children own their own spacing (a list of
// .card-row children, a chart that needs to bleed to the edge).
export default function Card({ flush = false, className = '', style, children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={['card', flush && 'card-flush', className].filter(Boolean).join(' ')} style={style} {...rest}>
      {children}
    </Tag>
  );
}
