import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function protocol(overrides = {}) {
  return {
    slug: 'atlas', name: 'Atlas Lending', category: 'Lending', chains: ['Ethereum', 'Base'],
    tvl_usd: 153_482_124.75, change_7d: 6.42, mcap_usd: null, listed_at: '2025-05-05',
    gecko_id: null, symbol: null, ...overrides,
  };
}

export function fixture() {
  return {
    as_of: '2026-11-14', source: 'Synthetic demo fixture (not market data)', floor_usd: 50_000_000,
    watchlist: ['atlas'],
    protocols: [protocol(), ...Array.from({ length: 100 }, (_, i) => protocol({
      slug: `early-${i}`, name: `Example ${i}`, category: i % 2 ? 'Yield' : 'Lending',
      tvl_usd: 1_000_000 + i * 401_001, change_7d: i % 8 - 2, chains: ['Base'],
    })), protocol({ slug: 'live-atlas', name: 'Atlas Peer', mcap_usd: 50_000_000, gecko_id: 'atlas-peer', symbol: 'ATL' }),
    protocol({ slug: 'live-yield', name: 'Yield Peer', category: 'Yield', tvl_usd: 450_000_000, mcap_usd: 360_000_000, gecko_id: 'yield-peer', symbol: 'YLP' }),
    protocol({ slug: 'unknown-token', name: 'Unclear Token', tvl_usd: 5_000_000, symbol: 'UNK' })],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node tests/fixture.mjs <snapshot.json>');
  writeFileSync(process.argv[2], JSON.stringify(fixture()));
}
