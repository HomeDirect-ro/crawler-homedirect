import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Persists which listing URLs were already checked (match, agency-skip, or
// gone) so repeated on-demand runs don't re-fetch the same pages — both
// friendlier to the site and lets you build up coverage over several small
// sessions instead of one large one.
export class SeenCache {
  constructor(filePath) {
    this.filePath = filePath;
    this.map = new Map();
  }

  static async load(filePath) {
    const cache = new SeenCache(filePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      const obj = JSON.parse(raw);
      cache.map = new Map(Object.entries(obj));
    } catch {
      // no cache yet — start fresh
    }
    return cache;
  }

  has(url) {
    return this.map.has(url);
  }

  record(url, result) {
    this.map.set(url, { result, checkedAt: new Date().toISOString() });
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const obj = Object.fromEntries(this.map);
    await writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
  }
}
