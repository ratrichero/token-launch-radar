import { chromium } from '/opt/hatch/skills/spaces/ts-runtime/dist/node_modules/playwright-core/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHROME = process.env.CHROME ||
  '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const outDir = process.argv[2] || '/tmp/opencode/shots';
const dashDir = process.argv[3] || join(ROOT, 'out', 'dashboard');

if (!existsSync(join(dashDir, 'index.html'))) {
  console.error('no index.html at', dashDir);
  process.exit(2);
}

const pageUrl = pathToFileURL(join(dashDir, 'index.html')).href;

const shots = [
  { name: '1-board.png', route: '', waitFor: '#rows tr' },
  { name: '2-detail.png', route: 'steakhouse-financial', waitFor: '#detail .formula' },
  { name: '3-filtered.png', route: 'category=Risk%20Curators', waitFor: '#rows tr' },
  { name: '4-model.png', route: 'model', waitFor: '#model .formula' },
];

import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const shot of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const url = shot.route ? pageUrl + '#' + shot.route : pageUrl;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector(shot.waitFor, { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const png = await page.screenshot({ type: 'png', fullPage: false });
  writeFileSync(join(outDir, shot.name), png);
  console.log(shot.name, png.length, 'bytes', 'errors:', errors.length ? errors : 'none');
  await ctx.close();
}

await browser.close();
