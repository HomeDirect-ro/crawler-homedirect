import { DEFAULT_USER_AGENT, ROBOTS_AGENT_TOKEN } from './config.js';

// Generic robots.txt support (RFC 9309): the group for our agent token if
// the file has one, otherwise the "*" group; Allow/Disallow with "*" and "$"
// wildcards, longest match wins, Allow wins ties. Fetched once per host per
// process and refreshed every 12 h. If robots.txt can't be read (5xx /
// network) we treat the host as fully disallowed rather than guessing.

const cache = new Map(); // host -> { rules, fetchedAt, disallowAll }
const TTL = 12 * 60 * 60 * 1000;

function parse(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a === ROBOTS_AGENT_TOKEN));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules).filter((r) => r.path || r.allow === false);
}

function toRegex(pattern) {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '$') re += '$';
    else re += ch.replace(/[.+?^{}()|[\]\\]/g, (c) => `\\${c}`);
  }
  return new RegExp(`^${re}`);
}

async function load(origin, userAgent) {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit;
  let entry;
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': userAgent } });
    if (res.status >= 500) entry = { disallowAll: true };
    else if (!res.ok) entry = { rules: [] }; // 4xx: no robots.txt → everything allowed
    else entry = { rules: parse(await res.text()).map((r) => ({ ...r, re: toRegex(r.path), len: r.path.length })) };
  } catch {
    entry = { disallowAll: true };
  }
  entry.fetchedAt = Date.now();
  cache.set(origin, entry);
  return entry;
}

export async function isAllowed(url, userAgent = DEFAULT_USER_AGENT) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const entry = await load(u.origin, userAgent);
  if (entry.disallowAll) return false;
  const target = u.pathname + u.search;
  let best = null;
  for (const r of entry.rules) {
    if (r.path === '' ) continue; // "Disallow:" (empty) = allow all
    if (!r.re.test(target)) continue;
    if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

// For tests.
export const _parse = parse;
