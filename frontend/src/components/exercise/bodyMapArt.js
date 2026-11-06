// Everything the body diagram needs that is not React: which body image to show, how the library's
// muscle outlines are regrouped into our sixteen drawn muscles, and how each outline is kept inside
// the body's own silhouette. Ported from the approved mockup (../design-mockups/muscle-map-shaded-v2,
// 2026-11-05) -- the library's own code is untouched; everything here is configuration.
//
// Art: js-rich-body-highlighter 0.1.1 (MIT, (c) 2026 js-rich-body-highlighter contributors) for the
// bodies and outlines; the heads are Nate's own drawings, fitted onto copies of the bodies by the
// mockup's build-tools/faces.js. The MIT notice ships with the app (Acknowledgements in Help).
import { MUSCLES as LIB_MUSCLES } from 'js-rich-body-highlighter';
import maleFrontLight from '../../assets/body/body-male-front-light.webp';
import maleFrontDark from '../../assets/body/body-male-front-dark.webp';
import maleBackLight from '../../assets/body/body-male-back-light.webp';
import maleBackDark from '../../assets/body/body-male-back-dark.webp';
import femaleFrontLight from '../../assets/body/body-female-front-light.webp';
import femaleFrontDark from '../../assets/body/body-female-front-dark.webp';
import femaleBackLight from '../../assets/body/body-female-back-light.webp';
import femaleBackDark from '../../assets/body/body-female-back-dark.webp';

const BODIES = {
  male: {
    front: { light: maleFrontLight, dark: maleFrontDark },
    back: { light: maleBackLight, dark: maleBackDark },
  },
  female: {
    front: { light: femaleFrontLight, dark: femaleFrontDark },
    back: { light: femaleBackLight, dark: femaleBackDark },
  },
};

export function bodySrc(gender, view, theme) {
  return BODIES[gender][view][theme];
}

// The library groups the back deltoid under shoulders and the whole back trapezius under
// upper_back. We draw rear delts and traps as muscles of their own, so: the back deltoid becomes
// rear_delts, the front trapezius becomes traps, and the back trapezius outline is used twice --
// above TRAP_CUT as traps, below it as upper_back (the library has no separate rhomboid outline).
// The cut is in the library's viewBox units and differs by body.
const TRAP_CUT = {
  male: [[60, 104], [125, 108], [181, 118], [237, 108], [300, 104]],
  female: [[60, 116], [130, 121], [181, 130], [232, 121], [300, 116]],
};

export const REGISTRY = LIB_MUSCLES.flatMap((m) => {
  if (m.id.startsWith('deltoids_back')) return [{ ...m, group: 'rear_delts', name: 'Rear deltoids' }];
  if (m.id.startsWith('trapezius')) return [{ ...m, group: 'traps' }];
  if (m.view === 'back' && m.group === 'upper_back') {
    return [
      { ...m, id: `${m.id}__traps`, group: 'traps', name: 'Trapezius (upper)', clip: 'above' },
      { ...m, group: 'upper_back', name: 'Trapezius (middle and lower)', clip: 'below' },
    ];
  }
  return [m];
});

const CLIP_OF = new Map(REGISTRY.filter((m) => m.clip).map((m) => [m.id, m.clip]));

// Which view shows each drawn muscle best -- used to pick the thumbnail's side. Calves and
// forearms show on both; front wins for them.
const BACK_MUSCLES = new Set(['rear_delts', 'upper_back', 'lats', 'lower_back', 'glutes', 'hamstrings', 'triceps']);

export function viewFor(primaryCodes) {
  const first = primaryCodes.find((code) => DRAWN.has(code));
  return first && BACK_MUSCLES.has(first) ? 'back' : 'front';
}

// The groups the art can shade. Must equal the `drawn` muscles in utils/muscles.js
// (bodyMapArt.test.js checks it against the library's registry too).
export const DRAWN = new Set([
  'chest', 'shoulders', 'rear_delts', 'traps', 'upper_back', 'lats', 'lower_back', 'biceps', 'triceps',
  'forearms', 'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'calves',
]);

const SVGNS = 'http://www.w3.org/2000/svg';
let maskSeq = 0;

// Keep each muscle's tint inside the body image's own outline (the fitted heads have slimmer necks
// than the library's trapezius outline expects), and cut the doubled back trapezius along TRAP_CUT.
// Each path gets an alpha mask of the body image, shifted against the path's own translate() so it
// lines up. A mask on the whole layer would break the multiply blend, so it is per path.
// Must run after every MuscleMap.update(), which re-renders the paths.
export function clipToBody(svg, gender, src) {
  const img = svg.querySelector(':scope > image');
  if (!img) return;
  let defs = svg.querySelector(':scope > defs.mm-clip');
  if (!defs) {
    defs = document.createElementNS(SVGNS, 'defs');
    defs.setAttribute('class', 'mm-clip');
    svg.insertBefore(defs, svg.firstChild);
  }
  defs.replaceChildren();
  // Ids are document-wide, and the thumbnail and the sheet can both be on screen.
  const prefix = `mm${++maskSeq}`;
  const made = new Map();
  svg.querySelectorAll('.mm-muscle-layer path').forEach((p) => {
    const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(p.getAttribute('transform') || '');
    const dx = m ? parseFloat(m[1]) : 0;
    const dy = m ? parseFloat(m[2]) : 0;
    const key = `${dx},${dy}`;
    if (!made.has(key)) {
      const id = `${prefix}-k${made.size}`;
      const mask = document.createElementNS(SVGNS, 'mask');
      mask.setAttribute('id', id);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '-2000');
      mask.setAttribute('y', '-2000');
      mask.setAttribute('width', '6000');
      mask.setAttribute('height', '6000');
      mask.style.maskType = 'alpha';
      const mi = document.createElementNS(SVGNS, 'image');
      mi.setAttribute('href', src);
      mi.setAttribute('x', String(-dx));
      mi.setAttribute('y', String(-dy));
      mi.setAttribute('width', img.getAttribute('width'));
      mi.setAttribute('height', img.getAttribute('height'));
      mi.setAttribute('preserveAspectRatio', img.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
      mask.appendChild(mi);
      defs.appendChild(mask);
      made.set(key, id);
    }
    p.setAttribute('mask', `url(#${made.get(key)})`);
    const side = CLIP_OF.get(p.getAttribute('data-muscle-id'));
    if (side) {
      const cid = `${prefix}-${side}-${made.get(key)}`;
      if (!defs.querySelector(`#${cid}`)) {
        const cut = TRAP_CUT[gender];
        const edge = side === 'above' ? -400 : 900;
        const pts = [[cut[0][0], edge], ...cut, [cut[cut.length - 1][0], edge]];
        const cp = document.createElementNS(SVGNS, 'clipPath');
        cp.setAttribute('id', cid);
        cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const poly = document.createElementNS(SVGNS, 'polygon');
        poly.setAttribute('points', pts.map(([x, y]) => `${x - dx},${y - dy}`).join(' '));
        cp.appendChild(poly);
        defs.appendChild(cp);
      }
      p.setAttribute('clip-path', `url(#${cid})`);
    }
  });
}
