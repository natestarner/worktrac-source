import { chromium } from 'playwright';

const OUT = process.argv[2] || '.';
const URL = process.env.MARKETING_URL || 'http://localhost:8099/';

const shots = [
  { name: 'desktop-light', width: 1440, height: 1000, scheme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, scheme: 'dark' },
  { name: 'tablet-light', width: 820, height: 1100, scheme: 'light' },
  { name: 'mobile-light', width: 390, height: 844, scheme: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, scheme: 'dark' },
];

const browser = await chromium.launch();
const problems = [];

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    colorScheme: s.scheme,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Horizontal overflow is the failure mode that matters most on a landing page.
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth };
  });
  if (overflow.scrollW > overflow.clientW + 1) {
    problems.push(`${s.name}: horizontal overflow ${overflow.scrollW} > ${overflow.clientW}`);
  }
  if (errors.length) problems.push(`${s.name}: console errors: ${errors.join(' | ')}`);

  await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: true });
  await ctx.close();
}

// Check the dev-host link rewrite actually fires.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.route('**/*', (route) => route.continue());
await page.goto(URL, { waitUntil: 'networkidle' });
const prodHrefs = await page.$$eval('a[href*="app.huddle.fitness"]', (as) => as.length);
await ctx.close();

await browser.close();

console.log(`prod CTA links found: ${prodHrefs}`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('No overflow, no console errors at any width.');
