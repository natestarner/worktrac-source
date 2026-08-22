import { chromium } from 'playwright';

const URL = process.env.MARKETING_URL || 'http://localhost:8099/';

function lum(r, g, b) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function parse(c) {
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
}

const browser = await chromium.launch();
const findings = [];

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  const samples = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('p, h1, h2, h3, a, span, li, td, th, caption');
    for (const el of els) {
      const text = (el.textContent || '').trim();
      if (!text || el.children.length > 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      // Collect the WHOLE background stack up to the first fully-opaque layer,
      // nearest-first. Stopping at the first non-transparent layer and
      // compositing it against white is wrong: a 5% accent tint over a dark
      // surface then reads as a near-white ground and reports false failures.
      const stack = [];
      let bgEl = el;
      while (bgEl) {
        const c = getComputedStyle(bgEl).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
          stack.push(c);
          if (!/rgba\([^)]*,\s*(0?\.\d+)\)/.test(c)) break; // opaque: done
        }
        bgEl = bgEl.parentElement;
      }
      out.push({
        text: text.slice(0, 46),
        fg: cs.color,
        bgStack: stack,
        size: parseFloat(cs.fontSize),
        weight: parseInt(cs.fontWeight, 10) || 400,
        sel: el.className || el.tagName,
      });
    }
    return out;
  });
  await ctx.close();

  const seen = new Set();
  const pageBase = scheme === 'dark' ? [23, 22, 20] : [250, 249, 247];
  for (const s of samples) {
    const fg = parse(s.fg);
    if (!fg || !s.bgStack.length) continue;
    // Composite the stack back-to-front onto the page ground.
    let bgSolid = pageBase;
    for (let i = s.bgStack.length - 1; i >= 0; i--) {
      const layer = parse(s.bgStack[i]);
      if (!layer) continue;
      bgSolid = layer[3] < 1 ? over(layer, bgSolid) : layer.slice(0, 3);
    }
    const fgSolid = fg[3] < 1 ? over(fg, bgSolid) : fg.slice(0, 3);
    const cr = ratio(fgSolid, bgSolid);
    // WCAG large text: >=24px any weight, or >=18.66px bold. 600 is treated as
    // NOT bold here -- deliberately conservative.
    const isLarge = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
    const need = isLarge ? 3.0 : 4.5;
    if (cr < need) {
      const key = `${scheme}|${s.fg}|${s.bgStack.join()}|${s.size}|${s.weight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(
        `${scheme.padEnd(5)} ${cr.toFixed(2)}:1 (need ${need})  ${s.size}px/${s.weight}  ${s.fg} on ${s.bgStack.join(" over ")}\n            "${s.text}"  [${s.sel}]`
      );
    }
  }
}

await browser.close();

if (findings.length) {
  console.log('CONTRAST FAILURES:');
  for (const f of findings) console.log('  ' + f);
  process.exit(1);
}
console.log('All sampled text meets WCAG AA in both schemes.');
