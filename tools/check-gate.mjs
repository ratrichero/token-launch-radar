import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node tools/check-gate.mjs <outDir> [snapshotPath]');
  process.exit(1);
}
const snapPath = process.argv[3];
if (!snapPath) {
  console.error('usage: node tools/check-gate.mjs <outDir> <snapshotPath>');
  process.exit(1);
}
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const slugs = new Set(snap.protocols.map((p) => p.slug));
const watchSet = new Set(snap.watchlist);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
}

const dashFiles = [];
function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else dashFiles.push({ path: p, rel: e.name, size: statSync(p).size });
  }
}
walk(join(outDir, 'dashboard'));
let dashOk = true;
let dashDetail = '';
const hasHtml = dashFiles.some((f) => f.rel.endsWith('.html'));
const hasCss = dashFiles.some((f) => f.rel.endsWith('.css'));
const hasJs = dashFiles.some((f) => f.rel.endsWith('.js'));
const totalDashBytes = dashFiles.reduce((n, f) => n + f.size, 0);
if (dashFiles.length > 400) { dashOk = false; dashDetail = `too many files: ${dashFiles.length}`; }
if (totalDashBytes > 4 * 1024 * 1024) { dashOk = false; dashDetail = `too many bytes: ${totalDashBytes}`; }
if (!hasHtml || !hasCss || !hasJs) { dashOk = false; dashDetail = `missing html=${hasHtml} css=${hasCss} js=${hasJs}`; }
for (const f of dashFiles) {
  const content = readFileSync(f.path, 'utf8');
  if (/https?:\/\//i.test(content)) {
    dashOk = false;
    dashDetail = `network URL in ${f.rel}`;
    break;
  }
}
check('dashboard_files', dashOk, dashDetail || `${dashFiles.length} files, ${totalDashBytes} bytes`);

const boardRaw = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = boardRaw.rows ?? boardRaw;
let boardOk = true;
let boardDetail = '';
if (rows.length < 100 || rows.length > 4000) { boardOk = false; boardDetail = `rows ${rows.length} outside 100-4000`; }
for (const r of rows) {
  if (!slugs.has(r.slug)) { boardOk = false; boardDetail = `unknown slug ${r.slug}`; break; }
  if (!r.name || typeof r.name !== 'string') { boardOk = false; boardDetail = `empty name ${r.slug}`; break; }
  if (!Number.isSafeInteger(r.rank) || r.rank < 1) { boardOk = false; boardDetail = `bad rank ${r.slug}`; break; }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 100000000000000) {
    boardOk = false; boardDetail = `bad implied ${r.slug}`; break;
  }
}
check('board_file', boardOk, boardDetail || `${rows.length} rows, valid slugs`);

const sorted = [...rows].sort((a, b) => a.rank - b.rank);
let rankOk = true;
let rankDetail = '';
for (let i = 0; i < sorted.length; i++) {
  if (sorted[i].rank !== i + 1) { rankOk = false; rankDetail = `rank ${i + 1} is ${sorted[i].rank}`; break; }
}
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].implied_value_usd > sorted[i - 1].implied_value_usd) {
    rankOk = false; rankDetail = `row ${i + 1} implied > row ${i}`; break;
  }
}
const distinct = new Set(rows.map((r) => r.implied_value_usd)).size;
if (rows.length >= 2 && distinct === 1) { rankOk = false; rankDetail = 'all rows same implied value'; }
check('sorted_by_value', rankOk, rankDetail || `ranks 1..${rows.length}, ${distinct} distinct implied values`);

const missing = [...watchSet].filter((s) => !new Set(rows.map((r) => r.slug)).has(s));
check('coverage', missing.length === 0, missing.length === 0 ? `all ${watchSet.size} watchlist slugs present` : `missing: ${missing.slice(0, 5).join(', ')}`);

let farmOk = true;
let farmDetail = '';
for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    farmOk = false; farmDetail = `${r.slug}: ${r.farm_steps?.length} steps`; break;
  }
  for (const s of r.farm_steps) {
    if (s.trim().length < 20 || s.trim().length > 600) { farmOk = false; farmDetail = `${r.slug}: step ${s.trim().length} chars`; break; }
  }
  if (!farmOk) break;
}
check('farm_steps', farmOk, farmDetail || `all ${rows.length} rows have 3-12 steps of 20-600 chars`);

const shotDir = join(outDir, 'screenshots');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
const shots = readdirSync(shotDir).filter((n) => !n.startsWith('.')).sort();
let shotOk = true;
let shotDetail = '';
if (shots.length < 3 || shots.length > 4) { shotOk = false; shotDetail = `${shots.length} screenshots (need 3-4)`; }
for (const n of shots) {
  const buf = readFileSync(join(shotDir, n));
  const isPng = buf.length >= 8 && PNG.every((b, i) => buf[i] === b);
  const isJpg = buf.length >= 3 && JPG.every((b, i) => buf[i] === b);
  if (!isPng && !isJpg) { shotOk = false; shotDetail = `${n} not PNG/JPEG`; break; }
  if (buf.length > 512 * 1024) { shotOk = false; shotDetail = `${n} ${buf.length} bytes > 512KiB`; break; }
}
check('screenshots', shotOk, shotDetail || `${shots.length} images OK`);

const { buildDossier } = await import(join(process.cwd(), 'vendor/makefun-board.ts'));
const expected = buildDossier(outDir, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 } });
const actual = readFileSync(join(outDir, 'dossier.json'));
const match = Buffer.compare(Buffer.from(expected), actual) === 0;
const doc = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8'));
check('dossier_matches', match, match ? `${actual.length} bytes, byte-identical` : 'mismatch');
check('dossier_text_cap', Buffer.byteLength(doc.text) <= 65_536, `${Buffer.byteLength(doc.text)} bytes of text`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gate checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
