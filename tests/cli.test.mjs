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
