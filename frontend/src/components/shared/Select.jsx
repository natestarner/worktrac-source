import { IconChevronDown } from './icons';

// A labelled native <select>.
//
// Native rather than a custom listbox, and deliberately not SegmentedToggle: on a phone iOS and
// Android render this as their own full-height wheel/sheet, which is a better one-handed target
// mid-workout than five pills squeezed into 390px. SegmentedToggle stays right where the labels are
// short and the choice is flicked between often (the Trends metric switchers); a select is right
// where the labels are long and the choice is set-and-forget.
//
// Extracted when the PRs board grew a second dropdown beside its sort. Four call sites had already
// hand-rolled this recipe with four different paddings, which is exactly the drift
// frontend-core.md's "reach for a primitive before writing a style object" rule exists to stop.
//
// The label sits ABOVE the field, not beside it. Side-by-side, "Record [Est. 1RM] ?" and
// "Sort [Most recent]" did not fit the 327px row a 375px iPhone leaves, so the PRs board's pair
// wrapped onto two lines at every phone width; with the labels on top the two fields share one row
// from 320px up (e2e/tests/prs-controls-layout.spec.ts).
//
// What you SEE is not the <select> itself: the native control is stretched transparently over a
// drawn field (.select-field) and still takes every tap, so the platform picker opens exactly as
// before. The drawing exists for two things a native <select> will not do reliably across
// browsers: ellipsize a value that does not fit (WebKit just clips it mid-letter), and size itself
// to its WIDEST option rather than the current one -- see .select-value -- so the row does not
// reflow each time a different option is picked.
//
// `sizeToLabels` overrides which labels that width is reserved for, for an option list that itself
// changes (the PRs sort list follows the selected record). `style` lands on the outer wrapper, so a
// call site can set how the field flexes within its row.
//
// fontSize MUST stay 16px on the <select>: below that, iOS Safari zooms the viewport on focus and
// the person has to pinch back out mid-workout. Two e2e specs assert the computed value on other
// inputs.
export default function Select({ id, label, value, onChange, options, sizeToLabels, fullWidth = false, style, children }) {
  // A persisted value that no longer names an option (see prSortSpec's fallback) shows the first
  // option, which is also what the native control itself displays in that case.
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="select" style={{ ...(fullWidth ? { width: '100%' } : {}), ...style }}>
      {(label || children) && (
        <div className="select-caption">
          {label && <label htmlFor={id}>{label}</label>}
          {/* Slot for a trailing control that belongs to this field -- the PRs board hangs its
              ChartHelp "?" here so the explanation sits with the picker it explains. It has to be
              in the caption, not the field: the field is covered edge to edge by the <select>. */}
          {children}
        </div>
      )}
      <div className="select-field pressable pressable-subtle">
        {/* Visual only; the <select> below carries the value for assistive tech. The sizers are
            pseudo-element text rather than real nodes, so no option label is duplicated into the
            DOM for a getByText to trip over. */}
        <span className="select-value" aria-hidden="true">
          {(sizeToLabels ?? options.map((option) => option.label)).map((sizer) => (
            <span key={sizer} className="select-value-sizer" data-label={sizer} />
          ))}
          <span className="select-value-text">{selected?.label}</span>
        </span>
        <IconChevronDown size={16} />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
