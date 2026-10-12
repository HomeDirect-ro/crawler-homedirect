import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Every ad id (private or not) seen on a results page, per source, with the
// day it was last seen. Discovery reads pages newest-first and stops at the
// first page whose ads are ALL already known — every run catches all new ads
// with the fewest possible requests. Entries older than 45 days are pruned.
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 45;

export class KnownIds {
  constructor(file) {
    this.file = file;
    this.map = new Map();
  }

  static async load(file) {
    const k = new KnownIds(file);
    try {
      const obj = JSON.parse(await readFile(file, 'utf8'));
      const cutoff = Math.floor(Date.now() / DAY) - KEEP_DAYS;
      for (const [key, day] of Object.entries(obj)) if (day >= cutoff) k.map.set(key, day);
    } catch { /* first run */ }
    return k;
  }

  has(source, id) { return this.map.has(`${source}|${id}`); }
  add(source, id) { this.map.set(`${source}|${id}`, Math.floor(Date.now() / DAY)); }
  get size() { return this.map.size; }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map)), 'utf8');
  }
}

/**
 * Generic "newest first until nothing new" pager used by the sources.
 * fetchPageAds(page) → { ids: [all ad ids on the page], listings: [private snapshots] } | null (no more pages)
 */
export async function pageUntilKnown({ source, known, maxPages, fetchPageAds, log, label }) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPageAds(page);
    if (!res || !res.ids.length) break;
    const fresh = res.ids.filter((id) => !known.has(source, id)).length;
    res.ids.forEach((id) => known.add(source, id));
    out.push(...res.listings);
    log?.(`${source} ${label} p${page}: ${res.ids.length} ads, ${fresh} new, ${res.listings.length} private`);
    if (fresh === 0) break; // reached what we already have
  }
  return out;
}
