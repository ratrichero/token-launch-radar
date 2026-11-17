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

export function computePeerTable(snapshot: Snapshot): { table: PeerStats[]; globalMedian: number; byCategory: Map<string, number>; peerCounts: Map<string, number> } {
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
  for (const [cat, arr] of byCat.entries()) {
    arr.sort((a, b) => a - b);
    const catMed = medianSorted(arr);
    const n = arr.length;
    const shrunk = (n * catMed + SHRINKAGE_GLOBAL_WEIGHT * globalMedian) / (n + SHRINKAGE_GLOBAL_WEIGHT);
    const clamped = Math.min(MULTIPLE_CLAMP_HI, Math.max(MULTIPLE_CLAMP_LO, shrunk));
    table.push({ category: cat, peers: n, catMedian: round4(catMed), multiple: round4(clamped) });
    multMap.set(cat, clamped);
    peerCounts.set(cat, n);
  }
  table.sort((a, b) => b.multiple - a.multiple || a.category.localeCompare(b.category));
  const result = new Map<string, number>();
  for (const [k, v] of multMap.entries()) result.set(k, v);
  return { table, globalMedian, byCategory: result, peerCounts };
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

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} USDC to ${name} on ${chain} and keep the position open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} liquidity to ${name}'s main pool on ${chain} and keep the LP position`;
  if (c.includes('bridge')) return `Bridge $${capital} USDC to ${chain} via ${name} and use the bridged funds in its app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${name} and hold the receipt token`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} USDC as margin on ${name} and open one small hedged position`;
  if (c.includes('prediction')) return `Fund $${capital} into ${name} and place one market position on an active outcome`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and retain the vault shares`;
  if (c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and retain the vault shares`;
  if (c.includes('capital')) return `Deposit $${capital} into a ${name} managed vault on ${chain} and retain the vault shares`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing RWA token on ${chain} via ${name} and hold it`;
  if (c.includes('insurance')) return `Purchase $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('index')) return `Mint $${capital} of the index token via ${name} on ${chain} and hold the position`;
  if (c.includes('launchpad')) return `Commit $${capital} to ${name} on ${chain} and participate in the next launch event`;
  if (c.includes('option')) return `Buy $${capital} of options exposure through ${name} on ${chain} and hold to expiry`;
  if (c.includes('payment')) return `Send $${capital} of payments volume through ${name} on ${chain} and keep the account active`;
  return `Deposit $${capital} USDC into ${name} on ${chain} and keep the position open`;
}

function secondChainAction(p: SnapshotProtocol, capital: number, chain2: string): string | null {
  if (p.chains.length < 2) return null;
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repeat the supply on ${chain2}: deposit $${capital} USDC to ${name} there for cross-chain activity`;
  if (c.includes('dex') || c.includes('yield')) return `Add $${capital} liquidity to ${name} on ${chain2} to show multi-chain usage`;
  if (c.includes('bridge')) return `Bridge another $${capital} via ${name} from ${chain2} back to the first chain to demonstrate round-trip usage`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain2} as well to diversify chain exposure`;
  return `Use ${name} on ${chain2} with $${capital} to establish cross-chain presence`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = gasEstimate(chain, capital);
  const action = actionFor(p, capital, chain);
  const steps: string[] = [];
  steps.push(`Create a dedicated wallet for farming with only the funds you plan to deploy, keeping the seed phrase stored offline securely`);
  steps.push(`${action}. Expected gas: ${gas}. Setup time: about 15 minutes`);
  if (p.chains.length >= 2) {
    const chain2 = p.chains[1]!;
    const cross = secondChainAction(p, capital, chain2);
    if (cross !== null) steps.push(`${cross}. Gas: ${gasEstimate(chain2, capital)}. Time: 15 minutes`);
  }
  steps.push(`Perform one qualifying interaction per week (deposit, borrow, swap, or vote) to maintain active status. Cost: ~$2 gas weekly`);
  steps.push(`Hold the position for at least ${hold} days so your activity spans multiple snapshots and qualifies for any future distribution`);
  steps.push(`Before withdrawing, visit only the protocol's official site to check points or rewards. Never pay a fee to claim and never follow third-party claim links`);
  steps.push(`Log every transaction, date, wallet address and amount in a personal tracker so you can reproduce or unwind the position later`);
  while (steps.length < 3) steps.push(`Monitor ${p.name} announcements on its official channels for any changes to the farming requirements`);
  return steps.map((s) => {
    if (s.length > 600) return s.slice(0, 597) + '...';
    if (s.length < 20) return s + '. Hold and verify on the protocol page.';
    return s;
  });
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; peerTable: PeerStats[]; globalMedian: number } {
  const { table: peerTable, globalMedian, byCategory, peerCounts } = computePeerTable(snapshot);
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
  return { board, peerTable, globalMedian };
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

export function radarRow(row: BoardRow): RadarRow {
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
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; peerTable: PeerStats[]; globalMedian: number } {
  const { board, peerTable, globalMedian } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const earlySize = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    peer_table: peerTable,
    rows: board.map(radarRow),
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