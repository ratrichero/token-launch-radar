import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixture } from './fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root });

test('CLI builds byte-identical output twice and passes the gate', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'radar-cli-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const input = join(temp, 'snapshot.json');
  writeFileSync(input, JSON.stringify(fixture()));
  const [a, b] = ['a', 'b'].map((name) => join(temp, name));
  for (const dir of [a, b]) {
    const result = run('main.ts', '--input', input, '--output', dir);
    assert.equal(result.status, 0, result.stderr);
  }
  const files = readdirSync(a, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const relative = (entry) => join(entry.parentPath.slice(a.length), entry.name);
  for (const file of files) assert.deepEqual(readFileSync(join(a, relative(file))), readFileSync(join(b, relative(file))), relative(file));
  const gate = run('tools/check-gate.mjs', a, input);
  assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);
  assert.match(gate.stdout, /8\/8/);
});

test('CLI reports invalid flags and invalid snapshots without a stack trace', (t) => {
  const flags = run('main.ts', '--input');
  assert.equal(flags.status, 2);
  assert.match(flags.stderr, /Usage:/);
  const temp = mkdtempSync(join(tmpdir(), 'radar-bad-input-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const input = join(temp, 'snapshot.json');
  writeFileSync(input, '{');
  const result = run('main.ts', '--input', input);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not JSON/);
  assert.doesNotMatch(result.stderr, /at parseSnapshot/);
});

test('comparison diagnoses all watchlist conflicts and still emits the report', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'radar-compare-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const input = join(temp, 'snapshot.json');
  const baseline = join(temp, 'baseline.json');
  writeFileSync(baseline, JSON.stringify({ rows: [{ slug: 'live-atlas', rank: 1 }] }));
  const snapshot = fixture();
  snapshot.watchlist.push('live-atlas', 'unknown-token', 'not-listed');
  writeFileSync(input, JSON.stringify(snapshot));
  const result = run('tools/compare-radar.mjs', baseline, input);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.watchlistConflicts.map(r => r.status), ['live', 'unknown', 'missing']);
  assert.deepEqual(report.removed, ['live-atlas']);
  assert.equal(report.top20Comparison[0].beforeRank, 1);
});

test('submission binds screenshots to the generated data and rejects tampering', async (t) => {
  const { captureInputs, captureManifest, shotNames, manifestName } = await import('../lib/capture.mjs');
  const { mkdirSync } = await import('node:fs');
  const temp = mkdtempSync(join(tmpdir(), 'radar-submission-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const input = join(temp, 'snapshot.json');
  const build = join(temp, 'build'), final = join(temp, 'final'), shots = join(temp, 'shots');
  const snapshot = fixture();
  writeFileSync(input, JSON.stringify(snapshot));
  assert.equal(run('main.ts', '--input', input, '--output', build).status, 0);
  mkdirSync(shots);
  const images = shotNames.map(name => [name, readFileSync(join(root, 'screenshots', name))]);
  for (const [name, bytes] of images) writeFileSync(join(shots, name), bytes);
  writeFileSync(join(shots, manifestName), captureManifest(captureInputs(join(build, 'dashboard')), images));
  const submit = (out) => run('main.ts', '--input', input, '--screenshots', shots, '--output', out, '--submission');
  assert.equal(submit(final).status, 0);
  assert.deepEqual(readdirSync(join(final, 'screenshots')).sort(), shotNames);
  snapshot.protocols[0].tvl_usd += 100;
  writeFileSync(input, JSON.stringify(snapshot));
  assert.match(submit(join(temp, 'stale')).stderr, /capture manifest mismatch/);
  snapshot.protocols[0].tvl_usd -= 100;
  writeFileSync(input, JSON.stringify(snapshot));
  writeFileSync(join(shots, shotNames[0]), 'tampered');
  assert.match(submit(join(temp, 'tampered')).stderr, /capture manifest mismatch/);
});
