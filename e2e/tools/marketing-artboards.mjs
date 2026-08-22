/* Measure each design artboard's rendered height against its canvas.json frame.
 * A frame smaller than its content CLIPS in the canvas -- surplus just paints background,
 * so this is the one sizing mistake worth checking before re-seeding.
 * Renders the .dc.html body with the {{holes}} resolved the way the runtime would.
 * Run from e2e/: node tools/marketing-artboards.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'marketing', 'design');
const canvas = JSON.parse(readFileSync(join(here, 'canvas.json'), 'utf8'));
const browser = await chromium.launch();

for (const ab of canvas.artboards) {
  const raw = readFileSync(join(here, ab.file), 'utf8');
  const helmet = (raw.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
  let body = (raw.match(/<x-dc>([\s\S]*?)<\/x-dc>/) || [, ''])[1].replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  // Resolve the one hole these artboards use.
  const dark = /"default":\s*true/.test(raw);
  body = body.replace(/\{\{themeClass\}\}/g, dark ? 'page dark' : 'page');

  const page = await browser.newPage({ viewport: { width: ab.w, height: 600 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.close();

  const verdict = h > ab.h ? `CLIPS by ${h - ab.h}px` : `ok (${ab.h - h}px slack)`;
  console.log(`${ab.file.padEnd(24)} frame ${String(ab.h).padStart(5)}  content ${String(h).padStart(5)}  ${verdict}`);
  ab._measured = h;
}

await browser.close();
