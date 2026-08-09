// The pill-group segmented control used across Trends -- range (4wk/12wk/All) and the two metric
// switchers. Extracted from RangeToggle so all three read as one control rather than three
// lookalikes that can drift apart.
//
// Options are `{ label, value }`; `value` can be any type since selection compares by identity.
//
// `fill` stretches the control to its container with the pills sharing the width evenly. Use it
// once there are more than ~3 options: at intrinsic width, five pills overflow a 390px phone and
// the last one gets clipped mid-word, which reads as a broken layout rather than as "scroll me".
//
// Geometry and colour now come from the shared .seg/.seg-item classes in index.css, which
// TabsNav uses too. The two controls were previously built separately -- same subtle-bg
// track, same white active pill, same shadow, but outer radius 10 vs 12 and pill radius 7
// vs 9 -- so two things that are obviously the same control didn't quite match. Anything
// that should look like a segmented control uses those classes; don't restyle here.
export default function SegmentedToggle({ options, value, onChange, ariaLabel, fill = false }) {
  return (
    <div role="group" aria-label={ariaLabel} className={fill ? 'seg seg-fill' : 'seg'}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={['seg-item', active && 'is-active', 'pressable'].filter(Boolean).join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
