/* The app's home-screen icons, rendered from the brand geometry on the charcoal tile.
 *
 *   node tools/app-icons.mjs            (from e2e/; writes into frontend/ in place)
 *
 * Writes, all opaque RGB (App Store Connect rejects an icon with an alpha channel):
 *   frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png       the iOS app icon
 *   frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-dark.png  iOS dark appearance
 *   frontend/public/apple-touch-icon.png (180), icon-192.png, icon-512.png         web home screen
 *   frontend/public/icon-maskable-192.png, icon-maskable-512.png                   PWA maskable
 *
 * 2026-11-22: Nate moved the home-screen icon from the kit's white tile to a warm CHARCOAL tile,
 * after comparing white, cream, charcoal and the kit's near-black (#14100E) side by side in App
 * Store search results and on the product page, in light and dark mode. Charcoal won search (it
 * reads as one set with the charcoal screenshots) and is right in both modes, so the dark
 * appearance is the SAME image, not the near-black variant. The tile is a slight vertical gradient,
 * #4A4642 -> #2F2D2B: a narrower range than the screenshots' ground (#55504B -> #242220), because a
 * full-strength gradient goes muddy at icon size. iOS adds its own lighting on top.
 *
 * The mark is exactly the kit's (logo/v3/logo/*.svg, 200-unit canvas): on a dark ground the cream
 * circle needs no hairline (docs/brand/README.md, rule 2). The maskable icons keep the mark inside
 * the central 60% (the kit's maskable layout), so any platform mask leaves clear space intact.
 *
 * NOT changed here, deliberately: the browser-tab favicons and icon.svg (already light/dark aware),
 * the marketing site's icons, og-image, and the manifest's colours.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('../../frontend/', import.meta.url));
const APPICON = `${FRONTEND}ios/App/App/Assets.xcassets/AppIcon.appiconset/`;
const PUBLIC = `${FRONTEND}public/`;

const TILE = ['#4A4642', '#2F2D2B'];
const MARK = `
  <circle cx="200" cy="175" r="34" fill="#E8734A"/>
  <circle cx="258" cy="168" r="29" fill="#F2A65A"/>
  <circle cx="198" cy="221" r="25" fill="#F2EDE1"/>
  <circle cx="250" cy="219" r="19" fill="#B5542D"/>`;
const tile = `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${TILE[0]}"/><stop offset="1" stop-color="${TILE[1]}"/></linearGradient></defs>`;

// The kit's standard icon: the mark on its 200-unit canvas, edge to edge.
const standard = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="126 92 200 200">
  ${tile}<rect x="126" y="92" width="200" height="200" fill="url(#t)"/>${MARK}</svg>`;
// The kit's maskable icon: the mark's tight 140-unit box in the central 60%.
const maskable = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512">
  ${tile}<rect width="512" height="512" fill="url(#t)"/>
  <svg x="102.4" y="102.4" width="307.2" height="307.2" viewBox="156.5 122.5 140 140">${MARK}</svg></svg>`;

const OUTPUTS = [
  [`${APPICON}AppIcon-1024.png`, 1024, standard],
  [`${APPICON}AppIcon-1024-dark.png`, 1024, standard],
  [`${PUBLIC}apple-touch-icon.png`, 180, standard],
  [`${PUBLIC}icon-192.png`, 192, standard],
  [`${PUBLIC}icon-512.png`, 512, standard],
  [`${PUBLIC}icon-maskable-192.png`, 192, maskable],
  [`${PUBLIC}icon-maskable-512.png`, 512, maskable],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [out, px, svg] of OUTPUTS) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<!doctype html><style>*{margin:0}body{width:${px}px;height:${px}px;overflow:hidden}svg{display:block}</style>${svg(px)}`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: px, height: px } });
  if (png.readUInt32BE(16) !== px || png.readUInt32BE(20) !== px) throw new Error(`${out}: wrong size`);
  if (png[25] !== 2) throw new Error(`${out}: not plain RGB (PNG colour type ${png[25]})`);
  writeFileSync(out, png);
  console.log(`${out.replace(FRONTEND, 'frontend/')} ${px}x${px}`);
}
await browser.close();
// The two iOS appearances are deliberately one image.
if (!readFileSync(`${APPICON}AppIcon-1024.png`).equals(readFileSync(`${APPICON}AppIcon-1024-dark.png`))) {
  throw new Error('the light and dark app icons differ');
}
