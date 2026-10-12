// Honest, self-identifying UA rather than impersonating a browser — the
// point of this crawler is to stay within what each portal permits, not to
// blend in. robots.txt groups are matched against ROBOTS_AGENT_TOKEN.
export const DEFAULT_USER_AGENT = 'HomeDirectResearchBot/1.0 (+mailto:niculai.gabriel@gmail.com)';
export const ROBOTS_AGENT_TOKEN = 'homedirectresearchbot';

// Pacing — sequential per host, several seconds apart (+/-20% jitter);
// different portals run in parallel since they're different servers.
export const DEFAULT_DELAY_MS = 4000;

// A blocked/challenged source pauses for this long before the next try,
// doubling on repeat blocks up to the max. We never retry around a block.
export const BACKOFF_FIRST_MS = 6 * 60 * 60 * 1000;
export const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

// How often each source's discovery runs in the worker loop.
export const DISCOVERY_INTERVAL_MS = 45 * 60 * 1000;

// Abort a source's run after this many consecutive failed pages.
export const CONSECUTIVE_FAILURE_ABORT = 3;

// Where the worker posts what it finds (homedirect API). The droplet holds
// only this key — never database credentials.
export const API_URL = (process.env.API_URL || 'http://localhost:8800/api').replace(/\/$/, '');
export const CRAWLER_INGEST_SECRET = process.env.CRAWLER_INGEST_SECRET || '';
export const INGEST_BATCH = 100;
