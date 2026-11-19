import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
export const manifestName = 'capture-manifest.json';
export const shotNames = ['1-board.png', '2-detail.png', '3-filtered.png', '4-model.png'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function captureInputs(dashboard, data = readFileSync(join(dirname(dashboard), 'data.js'))) {
  return { data: digest(data), dashboard: Object.fromEntries(readdirSync(dashboard).filter(n => !n.startsWith('.')).sort().map(n => [n, digest(readFileSync(join(dashboard, n)))])) };
}
export function captureManifest(inputs, images) {
  return JSON.stringify({ version: 1, inputs, images: Object.fromEntries(images.map(([name, bytes]) => [name, digest(bytes)])) });
}
export function verifyCapture(dir, inputs) {
  const actual = readFileSync(join(dir, manifestName), 'utf8').trim();
  const images = shotNames.map(name => [name, readFileSync(join(dir, name))]);
  if (actual !== captureManifest(inputs, images)) throw new Error('capture manifest mismatch: rebuild and recapture screenshots');
}
