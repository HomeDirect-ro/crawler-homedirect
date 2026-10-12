import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_URL, CRAWLER_INGEST_SECRET, INGEST_BATCH } from './config.js';

// Sends snapshots to the homedirect API (POST /market-listings/ingest).
// With --dry-run they go to output/dry-run.json instead.

export async function ingest(listings, { dryRun, outDir, log }) {
  if (!listings.length) return { created: 0, updated: 0 };
  if (dryRun) {
    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, 'dry-run.json');
    let prev = [];
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch { /* first run */ }
    await writeFile(file, JSON.stringify([...prev, ...listings], null, 2), 'utf8');
    log?.(`dry-run: ${listings.length} listings appended to ${file}`);
    return { created: 0, updated: 0, dryRun: listings.length };
  }
  if (!CRAWLER_INGEST_SECRET) throw new Error('CRAWLER_INGEST_SECRET is not set');
  const totals = { created: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < listings.length; i += INGEST_BATCH) {
    const res = await fetch(`${API_URL}/market-listings/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crawler-Key': CRAWLER_INGEST_SECRET },
      body: JSON.stringify({ listings: listings.slice(i, i + INGEST_BATCH) }),
    });
    if (!res.ok) throw new Error(`ingest HTTP ${res.status}`);
    const r = await res.json();
    totals.created += r.created || 0;
    totals.updated += r.updated || 0;
    totals.skipped += r.skipped || 0;
  }
  return totals;
}
