# 2026-11-27 — Typing a weight in Brave collapsed the Log screen

## Symptom

On an iPhone in Brave, tapping the Weight field on the Log screen squeezed the whole log form into
a sliver on the left: "Weight (lbs)" and "Reps" drawn over each other, the steppers crushed, the
"Enter a weight" button a few pixels wide, and a blank column filling the rest of the screen.
Safari and the App Store app were fine. It was on production too: the layout rule behind it shipped
in July (`7b9080a5`, the iPad landscape redesign), so every Brave-on-iPhone user since then hit it on
their first weight entry. Chrome on Android shrinks the page the same way and was almost certainly
affected as well.

## Root cause

The landscape layout in `index.css` was gated on `@media (orientation: landscape) and
(max-height: 900px)`. CSS `orientation` does not ask how the device is held. It only checks
whether the page is wider than it is tall.

Safari keeps the page full height when the keyboard opens and shows only part of it. Brave (and
Android Chrome) **shrink the page itself** to the space above the keyboard. With Brave's own toolbars,
a portrait iPhone is left with a page about 390 wide by about 300 tall, which CSS calls landscape. The
block then made `.exercise-detail-grid` two columns, `minmax(0, 1fr) minmax(280px, 340px)`. At 390px
the sets column took everything and the form's column computed to **0px** (`gridTemplateColumns`
measured `0px 322px` at 390×380 and 390×300).

## Fix

`@media (orientation: landscape) and (min-width: 640px) and (max-height: 900px)`. A keyboard can
shrink the page's height but never its width, and no phone is 640px wide held upright. The smallest
landscape phone (iPhone SE, 667px) keeps the two-column layout.

Pinned by `e2e/tests/log-keyboard-shrink.spec.ts` (`@critical`): it shrinks a 390px viewport to
500, 380 and 300 tall with Weight focused, and checks a 667×375 and an 844×390 landscape still
get two columns. It is red against the old query (`0px 322px`).

## Takeaway

**Never gate a layout on height or `orientation` alone.** In some browsers the keyboard changes the
page's height, so any height-based query can flip while someone is typing. Pair it with a width
condition the keyboard cannot change. Playwright can stand in for those browsers by shrinking the
viewport, since that is all they do to the page.

Known residue: an iPad held upright in a browser that shrinks the page (820 wide, ~600 tall with
the keyboard) still crosses into the two-column layout while typing. It does not collapse, because
there is room for both columns, but the screen does reflow.
