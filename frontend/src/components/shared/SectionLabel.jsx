// The uppercase micro-heading used above every group of content. It was previously
// redefined as a local `sectionLabelStyle` in eight files, at three different font sizes
// (11, 12 and 13px) -- so the same visual element was three slightly different elements
// depending on which screen you were on.
export default function SectionLabel({ className = '', style, children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={['section-label', className].filter(Boolean).join(' ')} style={style} {...rest}>
      {children}
    </Tag>
  );
}
