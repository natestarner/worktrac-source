// A blank screen is where an app most needs to look deliberate, and where this one
// previously did least: centre-aligned --color-faint text (2.07:1, effectively
// unreadable) at five different paddings depending on the tab.
//
// icon + title + one line of body + an optional action. Keep `body` to a single short
// sentence -- an empty state explains, it doesn't document.
export default function EmptyState({ icon: Icon, title, body, action, className = '', ...rest }) {
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')} {...rest}>
      {Icon && (
        <span className="empty-state-icon">
          <Icon size={32} />
        </span>
      )}
      {title && <div className="empty-state-title">{title}</div>}
      {body && <div className="empty-state-body">{body}</div>}
      {action}
    </div>
  );
}
