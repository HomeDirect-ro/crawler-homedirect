import { DEFAULT_USER_AGENT } from './config.js';
import { isAllowed } from './robots.js';

export class BlockedError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'BlockedError';
    this.status = status;
    this.url = url;
  }
}
export class DisallowedError extends Error {
  constructor(url) {
    super(`robots.txt disallows ${url}`);
    this.name = 'DisallowedError';
  }
}

// Bot-detection interstitials (DataDome, Cloudflare challenge…). Detecting
// them is only so a source can stop cleanly — we never solve or work around
// a challenge. Note: these portals also embed the DataDome *script* on normal
// pages, so we only treat it as a block when the real content is missing
// (see `looksReal` in fetchPage).
const CHALLENGE_RE = /captcha-delivery\.com|geo\.captcha|cf-chl-|challenge-platform|Just a moment\.\.\./i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));

// One polite queue per host: requests to the same portal never overlap and
// are spaced by `delayMs` ± 20%.
const lastHit = new Map();
async function pace(host, delayMs) {
  const prev = lastHit.get(host) || 0;
  const wait = prev + jitter(delayMs) - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/**
 * GET a page if robots.txt allows it. Returns { status, html }.
 * Throws DisallowedError (skip), BlockedError (stop the source).
 * `looksReal(html)` lets a source confirm the expected data is present.
 */
export async function fetchPage(url, { userAgent = DEFAULT_USER_AGENT, delayMs, accept = 'text/html,application/xhtml+xml', looksReal } = {}) {
  if (!(await isAllowed(url, userAgent))) throw new DisallowedError(url);
  const host = new URL(url).host;
  await pace(host, delayMs);
  const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'ro-RO,ro;q=0.9' }, redirect: 'follow' });
  if (res.status === 404 || res.status === 410) return { status: res.status, html: '', finalUrl: res.url };
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new BlockedError(`HTTP ${res.status} from ${host} — stopping this source rather than retrying`, { status: res.status, url });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const real = looksReal ? looksReal(html) : true;
  if (!real && CHALLENGE_RE.test(html)) {
    throw new BlockedError(`Bot challenge page from ${host} — stopping this source`, { status: res.status, url });
  }
  return { status: res.status, html, real, finalUrl: res.url };
}
