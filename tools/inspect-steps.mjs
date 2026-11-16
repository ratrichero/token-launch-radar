import { readFileSync } from 'node:fs';
const b = JSON.parse(readFileSync('out/board.json', 'utf8'));
let minL = Infinity, maxL = 0, bad = 0;
const counts = new Map();
for (const r of b.rows) {
  counts.set(r.farm_steps.length, (counts.get(r.farm_steps.length) ?? 0) + 1);
  for (const s of r.farm_steps) {
    const t = s.trim().length;
    if (t < minL) minL = t;
    if (t > maxL) maxL = t;
    if (t < 20 || t > 600) bad++;
  }
}
console.log('step count distribution:', [...counts.entries()].sort((a, b) => a[0] - b[0]));
console.log(`step length range: ${minL}..${maxL} chars, ${bad} out of range`);
const r1 = b.rows[0];
console.log('\nrow 1 farm steps:');
r1.farm_steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.length}] ${s}`));
