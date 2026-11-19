import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { boardIssue, buildRadar, isRankable, parseSnapshot, tokenStatus } from '../lib/model.ts';

const [baselinePath, snapshotPath] = process.argv.slice(2);
if (!baselinePath || !snapshotPath) {
  console.error('Usage: node tools/compare-radar.mjs <radar-2-board.json> <snapshot.json>');
  process.exit(2);
}
try {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).rows;
  if (!Array.isArray(baseline) || new Set(baseline.map(r => r.slug)).size !== baseline.length) throw new Error('expected a baseline board with unique slugs');
  const bytes = readFileSync(snapshotPath);
  const snapshot = parseSnapshot(bytes.toString('utf8'));
  const { board } = buildRadar(snapshot);
  const old = new Map(baseline.map(r => [r.slug, r]));
  const current = new Map(board.map(r => [r.slug, r]));
  const protocols = new Map(snapshot.protocols.map(p => [p.slug, p]));
  const factors = (r) => ({ tvl: r.tvl_usd, peer: r.model?.peer_multiple, growth: r.model?.growth_multiplier, maturity: r.model?.maturity_multiplier, chain: r.model?.chain_multiplier });
  function difference(slug) {
    const a = old.get(slug), b = current.get(slug);
    const x = a && factors(a), y = b && factors(b);
    const factorChanges = x && y ? Object.keys(x).map(name => ({ factor: name, before: x[name], after: y[name], pct: x[name] > 0 && Number.isFinite(y[name]) ? (y[name] / x[name] - 1) * 100 : null })) : [];
    factorChanges.sort((l, r) => Math.abs(r.pct ?? 0) - Math.abs(l.pct ?? 0));
    return { slug, beforeRank: a?.rank ?? null, afterRank: b?.rank ?? null, rankGain: a && b ? a.rank - b.rank : null, beforeUsd: a?.implied_value_usd ?? null, afterUsd: b?.implied_value_usd ?? null, factorChanges };
  }
  const top20 = new Set([...baseline, ...board].filter(r => r.rank <= 20).map(r => r.slug));
  const output = {
    asOf: snapshot.as_of,
    snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    caveat: 'Baseline snapshot identity cannot be proven from board.json. Radar-2 exported rounded factors; factor changes are diagnostic, not exact rank attribution.',
    beforeRows: baseline.length, afterRows: board.length,
    watchlistConflicts: snapshot.watchlist.flatMap(slug => {
      const p = protocols.get(slug);
      return p && isRankable(p) ? [] : [{ slug, status: p ? tokenStatus(p) : 'missing', reason: p ? 'excluded by current ranking rules' : 'not in snapshot' }];
    }),
    added: board.filter(r => !old.has(r.slug)).map(r => r.slug),
    removed: baseline.filter(r => !current.has(r.slug)).map(r => r.slug),
    top20Comparison: [...top20].map(difference),
    boardIssue: boardIssue(board, snapshot),
  };
  console.log(JSON.stringify(output, null, 2));
  if (output.boardIssue) process.exitCode = 1;
} catch (error) {
  console.error(`compare radar: ${error.message}`);
  process.exitCode = 2;
}
