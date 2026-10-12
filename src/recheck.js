import { API_URL, CRAWLER_INGEST_SECRET } from './config.js';
import { fetchPage } from './http.js';

// "Is it still online?" — the API hands out this source's listings not seen
// for 3+ days (oldest first); each ad page is opened once (paced like
// everything else) and reported back as seen or gone. Without this, a
// listing that scrolled off the newest-first pages would look stale even
// though the owner is still selling.

const headers = () => ({ 'Content-Type': 'application/json', 'X-Crawler-Key': CRAWLER_INGEST_SECRET });

export async function recheckSource(source, { delayMs, limit = 30, log }) {
  if (typeof source.recheckVerdict !== 'function') return null;
  const q = await fetch(`${API_URL}/market-listings/recheck?source=${source.name}&limit=${limit}`, { headers: headers() });
  if (!q.ok) throw new Error(`recheck queue HTTP ${q.status}`);
  const { listings = [] } = await q.json();
  if (!listings.length) return { seen: 0, gone: 0 };

  const seen = [];
  const gone = [];
  for (const l of listings) {
    const page = await fetchPage(l.sourceUrl, { delayMs, looksReal: source.recheckLooksReal });
    const verdict = source.recheckVerdict(page);
    if (verdict === 'alive') seen.push({ source: l.source, externalId: l.externalId });
    else if (verdict === 'gone') gone.push({ source: l.source, externalId: l.externalId });
  }
  const r = await fetch(`${API_URL}/market-listings/ingest`, { method: 'POST', headers: headers(), body: JSON.stringify({ listings: [], seen, gone }) });
  if (!r.ok) throw new Error(`recheck report HTTP ${r.status}`);
  log?.(`${source.name} recheck: ${listings.length} checked → ${seen.length} still online, ${gone.length} gone`);
  return { seen: seen.length, gone: gone.length };
}
