---
paths:
  - "frontend/src/components/exercise/body*"
  - "frontend/src/components/exercise/BodyMap*"
  - "frontend/src/assets/body/**"
---

# The body diagram's art

The eight `assets/body/*.webp` images are BUILT, not drawn here: js-rich-body-highlighter's bodies
plus Nate's head drawings, by `design-mockups/muscle-map-shaded-v2/build-tools/faces.js` (outside
this repo, one level up). `bodyMapArt.js`'s header says what each build step does.

- **The female images and her muscle outlines are moved by ONE function, `bodyShape.js`'s
  `shapeX`.** The build imports that file to reshape the images; `bodyMapArt.js` runs her outlines
  through `reshapePath` at load. Change a number in `bodyShape.js` and **rebuild the images**
  (`node faces.js <outDir>`, then copy the eight files here), or every female highlight lands off
  its muscle. Check alignment by overlaying all outlines on the new images, front and back.
- **`shapeX` must stay strictly increasing along every row** -- the build inverts it per row.
  `bodyShape.test.js`'s "never folds a row" pins it; any new push needs a ramp at least ~1.5x
  its amount wide.
- **Never edit the library to change the art.** Everything is configuration on our side
  (`REGISTRY`, `TRAP_CUT`, `clipToBody`, `bodyShape.js`); outline ids stay the library's, which
  e2e selects by (`pectoralis_female`).
- `reshapePath` handles the commands the library's outlines use (M/L/H/V/C/S/Q/T/Z, relative and
  absolute). A command letter is a token of exactly one letter -- numbers like `-1e-5` contain an
  `e`, and testing for "contains a letter" threw on the back outlines.
- The head/neck join is drawn from one smoothed outline with a cross-fade inside it (no erase line),
  and the heads are toned from the body's own pixels per theme. A seam, ledge or colour step at the
  neck at high zoom is a build-parameter problem (`FIT` in `faces.js`), not something to patch in
  CSS or the SVG.
