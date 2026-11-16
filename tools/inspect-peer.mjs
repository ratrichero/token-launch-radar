import { readFileSync } from 'node:fs';
const dataJs = readFileSync('out/data.js', 'utf8');
const d = JSON.parse(dataJs.replace(/^window\.RADAR=/, '').replace(/;$/, ''));
console.log('as_of:', d.as_of, '| global stats: watchlist', d.watchlist_size, 'board', d.board_size, 'early', d.early_size, 'live', d.live_size);
console.log('\nPeer table (multiple, peers, catMedian):');
for (const p of d.peer_table) console.log(`  ${p.category.padEnd(32)} mult=${p.multiple}  peers=${p.peers}  catMed=${p.catMedian}`);
const b = JSON.parse(readFileSync('out/board.json', 'utf8'));
console.log('\nTop 10:');
for (const r of b.rows.slice(0, 10)) {
  console.log(`  ${String(r.rank).padStart(2)}. ${r.slug.padEnd(26)} ${r.category.padEnd(24)} $${(r.tvl_usd/1e6).toFixed(1)}M  mult=${r.model.peer_multiple}  implied=$${(r.implied_value_usd/1e6).toFixed(1)}M`);
}
const min = b.rows[b.rows.length - 1].implied_value_usd;
console.log(`\nImplied range: $${(b.rows[0].implied_value_usd/1e6).toFixed(1)}M .. $${(min/1e3).toFixed(0)}K (last row ${b.rows[b.rows.length-1].slug})`);
console.log('board bytes:', readFileSync('out/board.json','utf8').length);
