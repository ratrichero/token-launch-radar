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

export const MODEL_VERSION = 'radar-3';

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
  category_median: number | null;
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
  global_median: number | null;
  global_peer_count: number;
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

export function computePeerTable(snapshot: Snapshot): { table: PeerStats[]; globalMedian: number | null; byCategory: Map<string, number>; peerCounts: Map<string, number>; catMedians: Map<string, number> } {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (tokenStatus(p) !== 'live' || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
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
  const globalMedian = ratios.length ? medianSorted(ratios) : null;
  const table: PeerStats[] = [];
  const multMap = new Map<string, number>();
  const peerCounts = new Map<string, number>();
  const catMedians = new Map<string, number>();
  for (const [cat, arr] of byCat.entries()) {
    arr.sort((a, b) => a - b);
    const catMed = medianSorted(arr);
    const n = arr.length;
    const shrunk = (n * catMed + SHRINKAGE_GLOBAL_WEIGHT * (globalMedian ?? catMed)) / (n + SHRINKAGE_GLOBAL_WEIGHT);
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
  globalMedian: number | null,
  peerCounts: Map<string, number>,
): { multiple: number; peers: number } {
  const key = category ?? '(no category)';
  const m = byCategory.get(key);
  if (m !== undefined) return { multiple: m, peers: peerCounts.get(key) ?? 0 };
  const shrunk = globalMedian ?? MULTIPLE_CLAMP_LO;
  const clamped = Math.min(MULTIPLE_CLAMP_HI, Math.max(MULTIPLE_CLAMP_LO, shrunk));
  return { multiple: clamped, peers: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function tokenStatus(p: SnapshotProtocol): 'pre-token' | 'live' | 'unknown' {
  if (p.mcap_usd === null && p.gecko_id === null && p.symbol === null) return 'pre-token';
  if (p.mcap_usd !== null && p.mcap_usd > 0 && p.gecko_id && p.symbol) return 'live';
  return 'unknown';
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return tokenStatus(p) === 'pre-token';
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
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

const LEND_KIT = "Verify which assets can be supplied; start by reviewing a supply quote without borrowing";
const CDP_KIT = "Check accepted collateral and liquidation thresholds; review a quote without opening debt";
const STAKE_KIT = "Stake a small amount of the underlying asset through the protocol and hold the staked position";
const DERIV_KIT = "Review margin, leverage and liquidation rules; prefer a testnet or simulation";
const PRED_KIT = "Review an active market and its resolution rules without placing a position";
const DEX_KIT = "Provide a small amount of the main pair as liquidity to the protocol and keep the pool position";
const VAULT_KIT = "Deposit a small amount into the protocol's vault and keep the position";
const STABLE_KIT = "Mint or deposit a small amount of the stable asset through the protocol and hold it";
const RWA_KIT = "Mint a small amount of the protocol's tokenized asset and hold it";
const PAY_KIT = "Keep a small amount on the protocol and run one small payment through it";
const INS_KIT = "Buy a small amount of cover from the protocol and keep the policy active";
const INDEX_KIT = "Mint a small amount of the index token via the protocol and hold the position";
const GOV_KIT = "Read a recent proposal and check voting eligibility without buying voting power";
const LOCK_KIT = "Review supported assets and the vesting schedule before creating a lock";
const MARKET_KIT = "Preview a trade and verify the listed asset and total fees";
const LAUNCH_KIT = "Review participation rules and lockups without committing funds";
const AI_KIT = "Use the protocol's main service with a small amount and keep the account funded";
const PRIV_KIT = "Hold a small amount of a major asset in the protocol and keep the position";
const CHAIN_KIT = "Review the network explorer and try a basic account action on a testnet if available";
const GENERIC_KIT = "Use the protocol's main product with a small amount";

function kitFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('bridge')) return GENERIC_KIT;
  const kits: [RegExp, string][] = [
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

export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0];
  return [
    `Find ${p.name}'s official docs and check for a published points or rewards program. This snapshot does not verify any program or eligibility; skip paid activity if rewards are your only goal.`,
    `Verify the official app, supported network${chain ? ` (the snapshot lists ${chain})` : ''}, minimums, live fees, risks and withdrawal or lockup rules before funding anything.`,
    `Optional product example: ${kitFor(p.category)}. Preview first or use a testnet if offered; a transaction is not needed to use this radar.`,
    `If you choose to transact after those checks, use a separate wallet, keep your recovery phrase offline and limit your total exposure including fees. A rough budget ceiling to consider is $${capitalFor(p.tvl_usd)}, not a required deposit.`,
    `Log your transaction, cost and exit plan. Do not repeat transactions, add networks or hold for an assumed snapshot without verified requirements. Never pay an unofficial claim fee.`,
  ].map((step) => step.length <= 600 ? step : step.slice(0, 597) + '...');
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; peerTable: PeerStats[]; globalMedian: number | null; catMedians: Map<string, number> } {
  const { table: peerTable, globalMedian, byCategory, peerCounts, catMedians } = computePeerTable(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isRankable(p)) chosen.set(slug, p);
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
      peer_multiple: s.peerMultiple,
      peer_count: s.peerCount,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p),
  }));
  return { board, peerTable, globalMedian, catMedians };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => tokenStatus(p) === 'live' && p.category !== 'CEX')
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

export function radarRow(row: BoardRow, categoryMedian: number | null): RadarRow {
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
    category_median: categoryMedian,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; peerTable: PeerStats[]; globalMedian: number | null } {
  const { board, peerTable, globalMedian, catMedians } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const earlySize = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const medianFor = (category: string | null): number | null => {
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
    global_median: globalMedian,
    global_peer_count: peerTable.reduce((sum, p) => sum + p.peers, 0),
    peer_table: peerTable,
    rows: board.map((r) => radarRow(r, medianFor(r.category))),
    live,
    watchlist: snapshot.watchlist.slice(),
  };
  return { board, radar, peerTable, globalMedian };
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const validSlug = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value);

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (!validDate(o.as_of)) throw new SnapshotError('snapshot.json has an invalid as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => !validSlug(s))) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  if (new Set(o.watchlist).size !== o.watchlist.length) throw new SnapshotError('duplicate watchlist slug');
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (!validSlug(p.slug) || typeof p.name !== 'string' || !p.name.trim() || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`protocol ${i} lacks slug, name or TVL`);
    }
    if (seen.has(p.slug)) throw new SnapshotError(`duplicate protocol slug: ${p.slug}`);
    seen.add(p.slug);
    if (p.listed_at != null && !validDate(p.listed_at)) throw new SnapshotError(`invalid listed_at for ${p.slug}`);
    if (p.mcap_usd != null && (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd) || p.mcap_usd < 0)) throw new SnapshotError(`invalid mcap_usd for ${p.slug}`);
    for (const field of ['gecko_id', 'symbol'] as const) {
      if (p[field] != null && typeof p[field] !== 'string') throw new SnapshotError(`invalid ${field} for ${p.slug}`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? [...new Set(p.chains.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean))] : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id.trim() || null : null,
      symbol: typeof p.symbol === 'string' ? p.symbol.trim() || null : null,
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
  if (slugs.size !== board.length) return 'duplicate board slugs';
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p && !isRankable(p)) return `watchlist conflict: ${slug} is ${tokenStatus(p)} and/or excluded by the ranking rules`;
  }
  for (const slug of slugs) {
    const p = index.get(slug);
    if (!p || !isRankable(p)) return `ineligible board slug: ${slug}`;
  }
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