import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SnapshotError, boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const usage = 'Usage: node main.ts [--input <snapshot.json|directory>] [--output <directory>] [--screenshots <directory>]';
function fail(message: string, code = 2): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

function options() {
  try {
    return parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, screenshots: { type: 'string' }, help: { type: 'boolean', short: 'h' } } }).values;
  } catch (error) {
    fail(`${(error as Error).message}\n${usage}`);
  }
}
const args = options();
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (args.input === '' || args.output === '' || args.screenshots === '') fail(usage);
const inputArg = args.input ?? '/input';
const inputFile = (existsSync(inputArg) ? statSync(inputArg).isFile() : inputArg.endsWith('.json'))
  ? inputArg : join(inputArg, 'snapshot.json');
const out = args.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function loadSnapshot() {
  try {
    return parseSnapshot(readFileSync(inputFile, 'utf8'));
  } catch (error) {
    if (error instanceof SnapshotError) fail(`${inputFile}: ${error.message}`);
    fail(`cannot read ${inputFile}: ${(error as Error).message}`);
  }
}
const snapshot = loadSnapshot();
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shotSource = args.screenshots ?? join(here, 'screenshots');
const shots = copyFiles(shotSource, join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: ${shotSource} holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

try {
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));
} catch (error) {
  fail(`could not write dossier: ${(error as Error).message}`, 1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
