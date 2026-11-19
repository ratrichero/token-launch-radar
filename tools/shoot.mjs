import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const [outDir, dashDir] = process.argv.slice(2);
if (!outDir || !dashDir) throw new Error('Usage: node tools/shoot.mjs <screenshots-dir> <built-dashboard-dir>');
const url = pathToFileURL(resolve(dashDir, 'index.html')).href;
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  const top = await page.evaluate(() => window.RADAR?.rows?.[0]);
  if (!top) throw new Error('No ranked protocols in the built dashboard');
  const route = (key, value) => new URLSearchParams({ [key]: value }).toString();
  const shots = [
    ['1-board.png', '', '#board:not(.hidden) .protocol-link'],
    ['2-detail.png', route('protocol', top.slug), '#detail:not(.hidden) .formula'],
    ['3-filtered.png', route('category', top.category || '(none)'), '#board:not(.hidden) .protocol-link'],
    ['4-model.png', 'view=model', '#model:not(.hidden) .formula'],
  ];
  const images = [];
  for (const [name, hash, selector] of shots) {
    await page.goto(hash ? `${url}#${hash}` : url);
    await page.locator(selector).first().waitFor({ timeout: 10_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const png = await page.screenshot({ type: 'png' });
    if (png.length > 524_288) throw new Error(`${name} exceeds 512 KiB`);
    images.push([name, png]);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  mkdirSync(outDir, { recursive: true });
  for (const [name, png] of images) {
    writeFileSync(join(outDir, name), png);
    console.log(`${name}: ${png.length} bytes`);
  }
} finally {
  await browser.close();
}
