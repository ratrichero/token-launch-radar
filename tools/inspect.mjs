import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2] ?? 'out';
const b = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
console.log('rows:', b.rows.length);
for (const r of b.rows.slice(0, 10)) {
  console.log(
    String(r.rank).padStart(3),
    r.slug.padEnd(28),
    (r.category ?? '-').padEnd(24),
    `$${(r.tvl_usd / 1e6).toFixed(1)}M`.padEnd(10),
    `mult=${r.model.peer_multiple}`,
    `implied=$${(r.implied_value_usd / 1e6).toFixed(1)}M`,
  );
}
const last = b.rows[b.rows.length - 1];
console.log('last row:', last.slug, 'implied=', last.implied_value_usd);
const data = readFileSync(join(out, 'data.js'), 'utf8').trim();
const wl = new Set(JSON.parse(data.replace(/^window\.RADAR=/, '').replace(/;$/, '')).watchlist);
console.log('watchlist in top40:', b.rows.slice(0, 40).filter((r) => wl.has(r.slug)).length);
console.log('farm steps sample (row 1):', JSON.stringify(b.rows[0].farm_steps, null, 1));
