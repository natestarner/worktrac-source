import BodyMap from '../exercise/BodyMap';
import ChartHelp from '../shared/ChartHelp';
import Card from '../shared/Card';
import SectionLabel from '../shared/SectionLabel';
import { MUSCLE_MAP_HELP } from './chartHelp';
import { rangeEmptyLabel } from './RangeToggle';
import { setsLabel, shadeFor } from '../../utils/muscleSets';

// Sets per muscle over the selected range, on a front and a back body, with the numbers beside them
// (utils/muscleSets.js has the rule). The list is the readout; the bodies are the at-a-glance
// version of the same numbers, so every shade on a body is also a row with a number and a name --
// nothing is said by colour alone.
//
// Follows the range toggle, like the weekly chart: "what have I been training lately" is a range
// question, unlike the consistency grid's fixed six months.

function bodyLabel(view, worked) {
  const side = view === 'front' ? 'Front' : 'Back';
  if (worked.length === 0) return `${side} of the body, no muscles shaded`;
  return `${side} of the body, shaded by sets per muscle`;
}

export default function MuscleMapCard({ muscleSets, weeks, gender = 'male' }) {
  if (!muscleSets) return null;
  const { worked, notWorked, conditioning, unlisted } = muscleSets;
  const maxSets = worked[0]?.sets ?? 0;
  const levels = Object.fromEntries(worked.map((m) => [m.code, shadeFor(m.sets, maxSets)]));

  return (
    <Card size="dense" data-testid="muscle-map">
      <div className="muscle-map-head">
        <div className="muscle-map-title">Muscles worked &middot; {rangeEmptyLabel(weeks)}</div>
        <ChartHelp help={MUSCLE_MAP_HELP} />
      </div>

      {/* Bodies above the list on a phone, beside it once the card is wide (a container query on
          .muscle-map-layout, so iPad split view gets the phone layout too). */}
      <div className="muscle-map-layout">
        <div className="muscle-map-grid">
          <div className="muscle-map-bodies">
            <BodyMap levels={levels} gender={gender} view="front" label={bodyLabel('front', worked)} />
            <BodyMap levels={levels} gender={gender} view="back" label={bodyLabel('back', worked)} />
          </div>

          {worked.length > 0 && (
            <div className="muscle-map-readout">
              <SectionLabel as="h3">Sets per muscle</SectionLabel>
              <ol className="muscle-map-list" aria-label="Sets per muscle">
                {worked.map((m) => (
                  <li key={m.code} className="muscle-map-row">
                    <span className="muscle-map-name">{m.name}</span>
                    <span className="muscle-map-track" aria-hidden="true">
                      <span
                        className="muscle-map-bar"
                        style={{ width: `${(m.sets / maxSets) * 100}%` }}
                      />
                    </span>
                    {/* The number alone keeps the bar wide on a 320px phone; the heading says what
                        it counts, and a screen reader still hears "3 sets". */}
                    <span className="muscle-map-sets">
                      {m.sets}
                      <span className="sr-only">{setsLabel(m.sets).slice(String(m.sets).length)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>

      <div className="muscle-map-notes">
        {worked.length > 0 && notWorked.length > 0 && (
          <p>Not worked: {notWorked.map((m) => m.name).join(', ')}.</p>
        )}
        {conditioning > 0 && (
          <p>
            Plus {setsLabel(conditioning)} of conditioning (full body or cardio), which count toward
            no single muscle.
          </p>
        )}
        {unlisted.length > 0 && (
          <p>
            Not counted, because no muscles are listed for them:{' '}
            {unlisted.map((u) => `${u.name} (${setsLabel(u.sets)})`).join(', ')}. Add them from
            Customize on the exercise.
          </p>
        )}
      </div>
    </Card>
  );
}
