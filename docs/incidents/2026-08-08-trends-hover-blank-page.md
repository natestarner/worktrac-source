# Hovering the Trends weekly chart blanked the whole page

**Date:** 2026-08-08
**Area:** Frontend — Trends tab, persisted per-person UI state
**Symptom:** On the Trends tab, moving the pointer over the "Volume lifted per week" chart made the
entire page go white. The chart rendered correctly right up until the hover.

## What happened

`WeeklyMetricChart` reads its metric spec twice. The chart body did it defensively:

```js
const spec = WEEKLY_METRICS[metric] || WEEKLY_METRICS.volume;
```

The tooltip did not:

```js
const spec = WEEKLY_METRICS[metric];   // undefined for an unrecognized metric
...
{value} {spec.isWeight ? defaultUnit : spec.label.toLowerCase()}   // TypeError
```

So an unrecognized `metric` rendered the chart perfectly and then threw the instant recharts
mounted the tooltip. A throw during render unmounts the tree — hence a blank page rather than a
broken chart, which is why it didn't look like a chart bug at all.

## Why `metric` was undefined

The weekly-metric switcher shipped on 2026-08-07, adding `trendsWeeklyMetric: 'volume'` to
`PERSON_DEFAULTS`. Two things then combined:

1. `HYDRATE` replaced `byPerson` **wholesale** from IndexedDB. A restored slice was used exactly as
   persisted — no merge against `PERSON_DEFAULTS` — so a slice written before 2026-08-07 had no
   `trendsWeeklyMetric` key at all.
2. `appStatePersistence.js`'s `SCHEMA_VERSION` was **not** bumped for that addition, so those old
   slices were considered valid and hydrated rather than discarded.

Anyone who had used the app before 2026-08-07 therefore hydrated with
`trendsWeeklyMetric === undefined` and hit the crash on their first hover. Touching the Sets/Reps/
Volume switcher once wrote a real value and "fixed" it permanently, which is why it was easy to
miss in testing on a fresh profile — a brand-new person never reproduces it.

`ExerciseTrendChart` was already immune: it routes every lookup through `metricSpec()`, which
falls back. That asymmetry between the two charts is the whole bug.

## Fix

- `weeklyMetricSpec()` added to `WeeklyMetricChart.jsx`, mirroring `exerciseMetrics.js`'s
  `metricSpec()`. **Both** the chart body and the tooltip now go through it.
- `HYDRATE` underlays `PERSON_DEFAULTS` beneath every restored slice
  (`{ ...PERSON_DEFAULTS, ...slice }`), so a field added to `PERSON_DEFAULTS` after a slice was
  written hydrates as its default instead of `undefined`.

The second fix is the general one: without it, every future field added to `PERSON_DEFAULTS`
carries the same latent crash for existing users.

## Rules this produced

- Never index a metric/spec lookup table directly in a component. Go through the module's
  fallback helper — `metricSpec`, `weeklyMetricSpec`, `prSortSpec` — every time, **including in
  tooltips and other lazily-mounted subcomponents**. The lazily-mounted ones are exactly where a
  missing fallback hides, because the first render looks fine.
- Adding a field to `PERSON_DEFAULTS` is a persisted-schema change. It is now safe by default
  thanks to the `HYDRATE` merge, but a change that makes an *existing* field's old values invalid
  still needs a `SCHEMA_VERSION` bump in `appStatePersistence.js`.
- When testing anything that reads persisted UI state, test the **upgrade** path — a slice missing
  the new key — not just a fresh profile.
