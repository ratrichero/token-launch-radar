export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2';

const DAY_MS = 86_400_000;
const MAX_AGE_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
const GROWTH_WEIGHT_UP = 0.4;
const GROWTH_WEIGHT_DOWN = 0.9;
const MATURITY_FLOOR = 0.65;
const MATURITY_RANGE = 0.35;
const CHAIN_BONUS = 0.04;
const CHAIN_MAX_EXTRA = 5;
const PEER_WINSOR_LO = 0.01;
const PEER_WINSOR_HI = 1.0;
const MULTIPLE_CLAMP_LO = 0.05;
const MULTIPLE_CLAMP_HI = 0.8;
const SHRINKAGE_GLOBAL_WEIGHT = 3;

export interface PeerStats {
  category: string;
  peers: number;
  catMedian: number;
  multiple: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_median: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  peer_table: PeerStats[];
  rows: RadarRow[];
  live: LiveRow[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function medianSorted(values: number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid]!;
  return (values[mid - 1]! + values[mid]!) / 2;
}

export function computePeerTable(snapshot: Snapshot): { table: PeerStats[]; globalMedian: number; byCategory: Map<string, number>; peerCounts: Map<string, number>; catMedians: Map<string, number> } {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    const w = Math.min(PEER_WINSOR_HI, Math.max(PEER_WINSOR_LO, r));
    ratios.push(w);
    const cat = p.category ?? '(no category)';
    let arr = byCat.get(cat);
    if (arr === undefined) {
      arr = [];
      byCat.set(cat, arr);
    }
    arr.push(w);
  }
  ratios.sort((a, b) => a - b);
  const globalMedian = medianSorted(ratios);
  const table: PeerStats[] = [];
  const multMap = new Map<string, number>();
  const peerCounts = new Map<string, number>();
  const catMedians = new Map<string, number>();
  for (const [cat, arr] of byCat.entries()) {
    arr.sort((a, b) => a - b);
    const catMed = medianSorted(arr);
    const n = arr.length;
    const shrunk = (n * catMed + SHRINKAGE_GLOBAL_WEIGHT * globalMedian) / (n + SHRINKAGE_GLOBAL_WEIGHT);
    const clamped = Math.min(MULTIPLE_CLAMP_HI, Math.max(MULTIPLE_CLAMP_LO, shrunk));
    table.push({ category: cat, peers: n, catMedian: round4(catMed), multiple: round4(clamped) });
    multMap.set(cat, clamped);
    peerCounts.set(cat, n);
    catMedians.set(cat, catMed);
  }
  table.sort((a, b) => b.multiple - a.multiple || a.category.localeCompare(b.category));
  const result = new Map<string, number>();
  for (const [k, v] of multMap.entries()) result.set(k, v);
  return { table, globalMedian, byCategory: result, peerCounts, catMedians };
}

function getPeerMultiple(
  category: string | null,
  byCategory: Map<string, number>,
  globalMedian: number,
  peerCounts: Map<string, number>,
): { multiple: number; peers: number } {
  const key = category ?? '(no category)';
  const m = byCategory.get(key);
  if (m !== undefined) return { multiple: m, peers: peerCounts.get(key) ?? 0 };
  const shrunk = (SHRINKAGE_GLOBAL_WEIGHT * globalMedian) / SHRINKAGE_GLOBAL_WEIGHT;
  const clamped = Math.min(MULTIPLE_CLAMP_HI, Math.max(MULTIPLE_CLAMP_LO, shrunk));
  return { multiple: clamped, peers: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peerMultiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, GROWTH_FLOOR, GROWTH_CAP);
  let growthMult: number;
  if (growthPct >= 0) {
    growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT_UP;
  } else {
    growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT_DOWN;
  }
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MAX_AGE_DAYS) / MAX_AGE_DAYS) * MATURITY_RANGE;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), CHAIN_MAX_EXTRA);
  const chainMult = 1 + CHAIN_BONUS * extraChains;
  const base = p.tvl_usd * peerMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult: round4(growthMult), maturityMult: round4(maturityMult), chainMult: round4(chainMult), age };
}

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function gasEstimate(chain: string, capital: number): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum') || c.includes('eth')) return `$${capital >= 150 ? 12 : 8}`;
  if (c.includes('solana')) return 'under $1';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon')) return '$1-3';
  return '$1-3';
}

interface StepKit {
  action: (n: string, c: number, ch: string) => string;
  second: (n: string, c: number, ch: string) => string;
  weekly: (n: string) => string;
}

const LEND_KIT: StepKit = {
  action: (n, c, ch) => `Supply $${c} of a major stablecoin to ${n} on ${ch} and keep the supply open`,
  second: (n, c, ch) => `Repeat the supply on ${ch}: deposit $${c} of a stablecoin to ${n} there and keep both positions`,
  weekly: (n) => `Perform one small supply, borrow or repayment on ${n} each week to keep the account active`,
};

const CDP_KIT: StepKit = {
  action: (n, c, ch) => `Lock $${c} of a major stablecoin as collateral in ${n} on ${ch} to open a position`,
  second: (n, c, ch) => `Open a second small CDP position in ${n} on ${ch} with $${c} to show cross-chain usage`,
  weekly: (n) => `Make one small collateral adjustment in ${n} each week to keep the position active`,
};

const STAKE_KIT: StepKit = {
  action: (n, c, ch) => `Stake $${c} of the underlying asset through ${n} on ${ch} and hold the staked position`,
  second: (n, c, ch) => `Stake $${c} through ${n} on ${ch} as well to diversify chain exposure`,
  weekly: (n) => `Re-stake or compound rewards through ${n} once a week to keep the position active`,
};

const DERIV_KIT: StepKit = {
  action: (n, c, ch) => `Deposit $${c} as margin on ${n} on ${ch} and open one small capped position`,
  second: (n, c, ch) => `Open one more small capped position on ${n} at ${ch} with $${c}`,
  weekly: (n) => `Roll or adjust your small position on ${n} once a week to keep the margin active`,
};

const PRED_KIT: StepKit = {
  action: (n, c, ch) => `Fund $${c} into ${n} on ${ch} and place one small position on an active outcome`,
  second: (n, c, ch) => `Place one small position in ${n} on ${ch} as well to show cross-chain usage`,
  weekly: (n) => `Place one small position on a fresh market in ${n} each week to stay active`,
};

const DEX_KIT: StepKit = {
  action: (n, c, ch) => `Provide $${c} of the main pair as liquidity to ${n} on ${ch} and keep the pool position`,
  second: (n, c, ch) => `Add $${c} of liquidity to ${n}'s main pool on ${ch} to show multi-chain usage`,
  weekly: (n) => `Swap through ${n} or rebalance your pool position once a week to stay active`,
};

const VAULT_KIT: StepKit = {
  action: (n, c, ch) => `Deposit $${c} into ${n}'s vault on ${ch} and keep the position`,
  second: (n, c, ch) => `Deposit $${c} into ${n}'s vault on ${ch} as well to show multi-chain usage`,
  weekly: (n) => `Top up or rebalance ${n}'s vault once a week to keep the deposit active`,
};

const STABLE_KIT: StepKit = {
  action: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold it`,
  second: (n, c, ch) => `Mint $${c} of the stable through ${n} on ${ch} as well to show cross-chain usage`,
  weekly: (n) => `Swap a small amount into or out of the stable through ${n} each week to stay active`,
};

const RWA_KIT: StepKit = {
  action: (n, c, ch) => `Mint $${c} of ${n}'s tokenized asset on ${ch} and hold it`,
  second: (n, c, ch) => `Mint $${c} of the tokenized asset via ${n} on ${ch} as well to show cross-chain usage`,
  weekly: (n) => `Check the ${n} position and make one small adjustment each week to keep it active`,
};

const PAY_KIT: StepKit = {
  action: (n, c, ch) => `Keep $${c} on ${n} on ${ch} and run one small payment through it`,
  second: (n, c, ch) => `Run one small payment through ${n} on ${ch} as well to show multi-chain usage`,
  weekly: (n) => `Run one small payment or settlement through ${n} each week to keep the account active`,
};

const INS_KIT: StepKit = {
  action: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active`,
  second: (n, c, ch) => `Keep a second small policy with ${n} on ${ch} to show multi-chain usage`,
  weekly: (n) => `Check the ${n} policy each week and keep it in force without lapses`,
};

const INDEX_KIT: StepKit = {
  action: (n, c, ch) => `Mint $${c} of the index token via ${n} on ${ch} and hold the position`,
  second: (n, c, ch) => `Mint $${c} of the index token via ${n} on ${ch} as well to show cross-chain usage`,
  weekly: (n) => `Rebalance or top up the index position via ${n} once a week to stay active`,
};

const GOV_KIT: StepKit = {
  action: (n, c, ch) => `Hold $${c} in ${n} on ${ch} and take part in one governance vote`,
  second: (n, c, ch) => `Use ${n} on ${ch} with $${c} as well, so your participation spans chains`,
  weekly: (n) => `Cast or delegate one governance vote via ${n} each week to stay active`,
};

const LOCK_KIT: StepKit = {
  action: (n, c, ch) => `Lock $${c} worth of an asset in ${n} on ${ch} for a set vesting period`,
  second: (n, c, ch) => `Place a second small lock in ${n} on ${ch} to show multi-chain usage`,
  weekly: (n) => `Check the ${n} lock each week and keep the locked position intact until it vests`,
};

const MARKET_KIT: StepKit = {
  action: (n, c, ch) => `Buy one listed asset through ${n} on ${ch} for around $${c} and keep it`,
  second: (n, c, ch) => `Make one small trade through ${n} on ${ch} as well to show multi-chain usage`,
  weekly: (n) => `Make one small trade through ${n} each week to keep the account active`,
};

const LAUNCH_KIT: StepKit = {
  action: (n, c, ch) => `Commit $${c} to ${n} on ${ch} and join its next public round`,
  second: (n, c, ch) => `Commit $${c} to ${n} on ${ch} as well, tracking its rounds on both chains`,
  weekly: (n) => `Check ${n}'s next round each week and keep your commitment ready to join`,
};

const AI_KIT: StepKit = {
  action: (n, c, ch) => `Use ${n}'s main service on ${ch} with $${c} and keep the account funded`,
  second: (n, c, ch) => `Use ${n}'s main service on ${ch} with $${c} as well to show multi-chain usage`,
  weekly: (n) => `Use ${n}'s main service with a small amount once a week to keep the account active`,
};

const PRIV_KIT: StepKit = {
  action: (n, c, ch) => `Hold $${c} of a major asset in ${n} on ${ch} and keep the position`,
  second: (n, c, ch) => `Hold part of the position in ${n} on ${ch} as well to show multi-chain usage`,
  weekly: (n) => `Make one small adjustment to the ${n} position each week to keep it active`,
};

const CHAIN_KIT: StepKit = {
  action: (n, c, ch) => `Keep $${c} in an active ${n} account on ${ch} and run normal transactions through it`,
  second: (n, c, ch) => `Keep a second ${n} account on ${ch} with $${c} to show multi-chain presence`,
  weekly: (n) => `Run a couple of normal transactions on ${n} each week to keep the account active`,
};

const GENERIC_KIT: StepKit = {
  action: (n, c, ch) => `Use ${n}'s main product on ${ch} with $${c} and keep the position open`,
  second: (n, c, ch) => `Use ${n}'s main product on ${ch} with $${c} as well to show multi-chain usage`,
  weekly: (n) => `Perform one qualifying interaction on ${n} each week (deposit, swap or vote) to stay active`,
};

function kitFor(category: string | null): StepKit {
  const c = (category ?? '').toLowerCase();
  if (c.includes('bridge')) return GENERIC_KIT;
  const kits: [RegExp, StepKit][] = [
    [/lending|cede/, LEND_KIT],
    [/cdp/, CDP_KIT],
    [/restak|staking|anchor btc|decentralized btc/, STAKE_KIT],
    [/derivatives|options|collateral markets|synthetics/, DERIV_KIT],
    [/prediction/, PRED_KIT],
    [/\bdex|farm/, DEX_KIT],
    [/yield|allocator|curator|basis trading|liquidity manager/, VAULT_KIT],
    [/stable|algo|reserve currency/, STABLE_KIT],
    [/rwa/, RWA_KIT],
    [/payment|crypto card/, PAY_KIT],
    [/insurance/, INS_KIT],
    [/index/, INDEX_KIT],
    [/governance/, GOV_KIT],
    [/locker/, LOCK_KIT],
    [/nft|otc/, MARKET_KIT],
    [/launch/, LAUNCH_KIT],
    [/\bai\b|agent/, AI_KIT],
    [/privacy/, PRIV_KIT],
    [/^chain$/, CHAIN_KIT],
  ];
  for (const [re, kit] of kits) if (re.test(c)) return kit;
  return GENERIC_KIT;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = gasEstimate(chain, capital);
  const kit = kitFor(p.category);
  const steps: string[] = [];
  steps.push(`Create a dedicated wallet for farming with only the funds you plan to deploy, keeping the seed phrase stored offline securely`);
  steps.push(`${kit.action(p.name, capital, chain)}. Expected gas: ${gas}. Setup time: about 15 minutes`);
  if (p.chains.length >= 2) {
    const chain2 = p.chains[1]!;
    steps.push(`${kit.second(p.name, capital, chain2)}. Gas: ${gasEstimate(chain2, capital)}. Time: 15 minutes`);
  }
  steps.push(`${kit.weekly(p.name)}. Cost: ~$2 gas weekly`);
  steps.push(`Hold the position for at least ${hold} days so your activity spans multiple snapshots and qualifies for any future distribution`);
  steps.push(`Before withdrawing, visit only the protocol's official site to check points or rewards. Never pay a fee to claim and never follow third-party claim links`);
  steps.push(`Log every transaction, date, wallet address and amount in a personal tracker so you can reproduce or unwind the position later`);
  return steps.map((s) => {
    if (s.length > 600) return s.slice(0, 597) + '...';
    if (s.length < 20) return s + '. Hold and verify on the protocol page.';
    return s;
  });
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; peerTable: PeerStats[]; globalMedian: number; catMedians: Map<string, number> } {
  const { table: peerTable, globalMedian, byCategory, peerCounts, catMedians } = computePeerTable(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const pm = getPeerMultiple(p.category, byCategory, globalMedian, peerCounts);
    const iv = impliedValue(p, snapshot.as_of, pm.multiple);
    return { p, ...iv, peerMultiple: pm.multiple, peerCount: pm.peers };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_count: s.peerCount,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, peerTable, globalMedian, catMedians };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow, categoryMedian: number): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_median: round6(categoryMedian),
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; peerTable: PeerStats[]; globalMedian: number } {
  const { board, peerTable, globalMedian, catMedians } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const earlySize = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const medianFor = (category: string | null): number => {
    const key = category ?? '(no category)';
    const m = catMedians.get(key);
    return m !== undefined ? m : globalMedian;
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    global_median: round6(globalMedian),
    peer_table: peerTable,
    rows: board.map((r) => radarRow(r, medianFor(r.category))),
    live,
    watchlist: snapshot.watchlist.slice(),
  };
  return { board, radar, peerTable, globalMedian };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} step length ${s.length}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} implied ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}