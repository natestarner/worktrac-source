// A button whose entire label is an icon.
//
// `label` is REQUIRED and becomes the accessible name -- the icon itself is aria-hidden,
// so without it the control is unlabelled for a screen reader. It is also what several
// e2e specs select set-row controls by: `getByRole('button', { name: 'Edit' })`. When
// converting a text link to an icon button, the label must be the exact former text.
//
// Note the accessible name is matched as a substring by Playwright's `name` option, so
// adding a NEW control whose label contains an existing one ("Edit note for this
// session" alongside "Edit") on the same screen will break a toHaveCount assertion
// elsewhere. Keep labels on one screen mutually non-containing.
export default function IconButton({ icon: Icon, label, tone = 'default', size = 18, className = '', ...rest }) {
  const toneClass = tone === 'accent' ? 'icon-btn-accent' : tone === 'danger' ? 'icon-btn-danger' : '';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={['icon-btn', toneClass, 'pressable', 'pressable-subtle', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Icon size={size} />
    </button>
  );
}
