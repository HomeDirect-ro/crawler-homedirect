import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const CSV_COLUMNS = [
  'externalId', 'title', 'ownerName', 'type', 'price', 'currency',
  'city', 'address', 'rooms', 'surface', 'sourceUrl', 'description',
];

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }
  return lines.join('\n');
}

// Upserts matched listings (keyed by externalId) into a running master
// JSON file, then writes a fresh CSV snapshot of the full current set.
export async function saveResults(outDir, newListings) {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'private-owners.json');
  const csvPath = path.join(outDir, 'private-owners.csv');

  let existing = [];
  try {
    existing = JSON.parse(await readFile(jsonPath, 'utf8'));
  } catch {
    // no prior output yet
  }

  const byId = new Map(existing.map((l) => [l.externalId, l]));
  for (const listing of newListings) {
    byId.set(listing.externalId, { ...listing, capturedAt: new Date().toISOString() });
  }
  const merged = [...byId.values()];

  await writeFile(jsonPath, JSON.stringify(merged, null, 2), 'utf8');
  await writeFile(csvPath, toCsv(merged), 'utf8');

  return { jsonPath, csvPath, total: merged.length };
}
