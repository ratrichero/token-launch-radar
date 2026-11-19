import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardIssue, buildRadar, farmSteps, impliedValue, parseSnapshot, tokenStatus } from '../lib/model.ts';
import { fixture, protocol } from './fixture.mjs';

const parse = (snapshot) => parseSnapshot(JSON.stringify(snapshot));

test('live and ambiguous token metadata never get ranked; watchlist conflicts explain why', () => {
  const snapshot = fixture();
  const result = buildRadar(snapshot);
  assert.equal(result.board.length, 101);
  assert.equal(result.radar.live.length, 2);
  assert.equal(tokenStatus(snapshot.protocols.at(-1)), 'unknown');
  for (const slug of ['live-atlas', 'unknown-token']) {
    snapshot.watchlist = [slug];
    const { board } = buildRadar(snapshot);
    assert.ok(!board.some((row) => row.slug === slug));
    assert.match(boardIssue(board, snapshot), new RegExp(`watchlist conflict: ${slug}`));
  }
  snapshot.watchlist = ['missing'];
  assert.match(boardIssue(buildRadar(snapshot).board, snapshot), /missing .* watchlist/);
});

test('parser rejects bad dates, duplicate slugs and negative TVL; deduplicates chains', () => {
  for (const [modify, pattern] of [
    [s => s.as_of = '2026-02-30', /as_of/],
    [s => s.protocols[0].listed_at = '2024-04-31', /listed_at/],
    [s => s.protocols.push(s.protocols[0]), /duplicate protocol/],
    [s => s.watchlist.push('atlas'), /duplicate watchlist/],
    [s => s.protocols[0].tvl_usd = -1, /TVL/],
  ]) {
    const snapshot = fixture();
    modify(snapshot);
    assert.throws(() => parse(snapshot), pattern);
  }
  const snapshot = fixture();
  snapshot.protocols[0].chains.push(' Base ', '');
  assert.deepEqual(parse(snapshot).protocols[0].chains, ['Ethereum', 'Base']);
});

test('exported factors reproduce the model exactly for every row', () => {
  const { board, radar } = buildRadar(parse(fixture()));
  for (const r of radar.rows) {
    const expected = Math.max(1, Math.round(r.tvl_usd * r.peer_multiple * r.growth_multiplier * r.maturity_multiplier * r.chain_multiplier));
    assert.equal(expected, r.implied_value_usd);
    assert.equal(expected, board[r.rank - 1].implied_value_usd);
  }
});

test('missing peers are explicit; growth, age and chain factors have bounds', () => {
  const snapshot = { ...fixture(), protocols: [protocol()] };
  const { radar } = buildRadar(snapshot);
  assert.equal(radar.global_peer_count, 0);
  assert.equal(radar.global_median, null);
  assert.equal(radar.rows[0].peer_multiple, 0.05);
  const score = (props) => impliedValue(protocol(props), snapshot.as_of, .2);
  assert.equal(score({ change_7d: 1_000 }).growthMult, 1.48);
  assert.ok(Math.abs(score({ change_7d: -1_000 }).growthMult - .46) < 1e-12);
  assert.equal(score({ chains: Array.from({ length: 10 }, (_, i) => String(i)) }).chainMult, 1.2);
  assert.equal(score({ listed_at: '2000-01-01' }).maturityMult, 1);
});

test('ties resolve by slug and a flat board is rejected by the gate contract', () => {
  const snapshot = { ...fixture(), watchlist: [], protocols: [protocol({ slug: 'b', tvl_usd: 100 }), protocol({ slug: 'a', tvl_usd: 100 })] };
  const { board } = buildRadar(snapshot);
  assert.deepEqual(board.map((r) => r.slug), ['a', 'b']);
  assert.match(boardIssue(board, snapshot), /same implied value/);
});

test('farm steps verify before spending and keep the action category-specific', () => {
  const steps = farmSteps(protocol());
  assert.match(steps[0], /does not verify/);
  assert.match(steps[1], /withdrawal.*before funding/);
  assert.match(steps[2], /supply quote without borrowing/);
  assert.match(farmSteps(protocol({ category: 'Derivatives' }))[2], /liquidation/);
  assert.ok(steps.every((s) => s.length >= 20 && s.length <= 600));
  assert.doesNotMatch(steps.join(' '), /qualifies for|\$2 gas|repeat the supply/i);
});

test('peer audit exports precisely the observations used by the model', () => {
  const snapshot = fixture();
  snapshot.protocols.push(protocol({ slug: 'capped', tvl_usd: 1, mcap_usd: 10, gecko_id: 'cap', symbol: 'CAP' }));
  const { radar } = buildRadar(snapshot);
  const observations = radar.peer_observations;
  assert.equal(observations.length, radar.global_peer_count);
  assert.deepEqual(observations.find(p => p.slug === 'capped'), { slug: 'capped', name: 'Atlas Lending', category: 'Lending', raw: 10, bounded: 1 });
  assert.equal(observations.filter(p => p.category === 'Lending').length, radar.rows[0].peer_count);
});
