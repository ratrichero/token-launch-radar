import { readFileSync } from 'node:fs';

export function loadFarmEvidence(path, asOf) {
  const input = JSON.parse(readFileSync(path, 'utf8'));
  const record = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const text = (x) => typeof x === 'string' && x.trim() && x.length <= 600;
  if (!record(input)) throw new Error('expected an object keyed by protocol slug');
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([slug, entry]) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug) || !record(entry)) throw new Error(`invalid entry: ${slug}`);
    const { source, checked_at, networks, eligibility, exit } = entry;
    const url = URL.parse(source);
    if (!text(source) || !url || url.protocol !== 'https:' || url.username || url.password) throw new Error(`invalid source for ${slug}`);
    const date = new Date(`${checked_at}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checked_at) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== checked_at || checked_at > asOf) throw new Error(`invalid checked_at for ${slug}: must be on or before snapshot date`);
    if (!Array.isArray(networks) || !networks.length || networks.length > 20 || !networks.every(text) || !text(eligibility) || !text(exit)) throw new Error(`missing or invalid networks, eligibility or exit for ${slug}`);
    return [slug, { source, checked_at, networks, eligibility, exit }];
  }));
}
