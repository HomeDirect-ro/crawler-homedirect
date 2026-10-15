import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DELAY_MS, DISCOVERY_INTERVAL_MS, BACKOFF_FIRST_MS, BACKOFF_MAX_MS } from './config.js';
import { BlockedError } from './http.js';
import { SeenCache } from './seenCache.js';
import { KnownIds } from './known.js';
import { recheckSource } from './recheck.js';
import { ingest } from './ingest.js';
import olx from './sources/olx.js';
import storia from './sources/storia.js';
import publi24 from './sources/publi24.js';
import imobiliare from './sources/imobiliare.js';

// Discovery worker for the "Anunțuri Particulari" feed. Each portal runs on
// its own loop (portals in parallel, requests to one portal strictly
// sequential and spaced — see http.js). A blocked portal is paused with
// exponential back-off (6 h → 24 h) and never retried around the block.
//
//   node --env-file=.env src/worker.js                  run forever
//   node src/worker.js --once --source=olx --dry-run    one pass, no API
//   node src/worker.js --once --backfill --source=storia   slow deep first pass
//   flags: --source=a,b  --pages=N (max pages per category; stops earlier at
//          the first page with nothing new)  --limit=N (imobiliare ads/run)
//          --delay=ms  --out=dir  --once  --dry-run  --backfill  --no-recheck
//          --refresh (re-read --pages pages even when nothing is new, so ads
//          already saved get re-sent — e.g. after a parser fix; slow like backfill)
//   node --env-file=.env src/worker.js --once --refresh --source=publi24 --pages=15

const SOURCES = { olx, storia, publi24, imobiliare };
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  // CRAWLER_SOURCES in .env (e.g. "publi24") picks the portals for this host;
  // --source= on the command line overrides it.
  const envSources = (process.env.CRAWLER_SOURCES || '').split(',').map((s) => s.trim()).filter((s) => SOURCES[s]);
  const a = { sources: envSources.length ? envSources : Object.keys(SOURCES), pages: 5, limit: 60, delay: DEFAULT_DELAY_MS, out: path.join(__dirname, '..', 'output'), once: false, dryRun: false, backfill: false, refresh: false, recheck: true };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, '').split(/=(.*)/s);
    if (k === 'source') a.sources = v.split(',').filter((s) => SOURCES[s]);
    else if (k === 'pages') a.pages = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'limit') a.limit = Math.max(1, parseInt(v, 10) || 60);
    else if (k === 'delay') a.delay = Math.max(2000, parseInt(v, 10) || DEFAULT_DELAY_MS);
    else if (k === 'out') a.out = path.resolve(v);
    else if (k === 'once') a.once = true;
    else if (k === 'dry-run') a.dryRun = true;
    else if (k === 'no-recheck') a.recheck = false;
    else if (k === 'backfill') a.backfill = true;
    else if (k === 'refresh') a.refresh = true;
  }
  // Backfill: go deep once, but twice as slow as normal runs.
  if (a.refresh) a.delay = Math.max(a.delay, 8000);
  if (a.backfill) {
    if (!argv.some((x) => x.startsWith('--pages'))) a.pages = 40;
    a.delay = Math.max(a.delay, 8000);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function loadState(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}
async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}

async function runSource(name, args, state, stateFile, seen, known) {
  const log = (msg) => console.log(`[${stamp()}] ${msg}`);
  const s = state[name] || (state[name] = {});
  if (s.blockedUntil && Date.now() < s.blockedUntil) {
    log(`${name}: paused (blocked) until ${new Date(s.blockedUntil).toISOString()}`);
    return;
  }
  try {
    const delayMs = Math.max(args.delay, SOURCES[name].minDelayMs || 0);
    const maxPages = Math.min(args.pages, SOURCES[name].maxPagesCap || Infinity);
    // --refresh: report every id as new so paging doesn't stop at known ads
    // (ids are still recorded, so normal runs afterwards stay incremental).
    const knownView = args.refresh ? { has: () => false, add: (src, id) => known.add(src, id), get size() { return known.size; } } : known;
    const found = await SOURCES[name].discover({ maxPages, limit: args.limit, delayMs, seen, known: knownView, log });
    const r = await ingest(found, { dryRun: args.dryRun, outDir: args.out, log });
    log(`${name}: ${found.length} private listings → created ${r.created ?? 0}, updated ${r.updated ?? 0}${r.dryRun ? ' (dry run)' : ''}`);
    if (args.recheck && !args.dryRun && !args.backfill && !args.refresh) await recheckSource(SOURCES[name], { delayMs, log });
    s.lastOkAt = new Date().toISOString();
    s.backoffMs = 0;
    s.blockedUntil = null;
  } catch (err) {
    if (err instanceof BlockedError) {
      // Never worked from this machine and refused straight away = the portal
      // blocks this host (e.g. cloud IP ranges): go straight to the long pause.
      s.backoffMs = !s.lastOkAt
        ? BACKOFF_MAX_MS
        : Math.min(s.backoffMs ? s.backoffMs * 2 : BACKOFF_FIRST_MS, BACKOFF_MAX_MS);
      s.blockedUntil = Date.now() + s.backoffMs;
      s.lastBlock = { at: new Date().toISOString(), message: err.message };
      log(`${name}: BLOCKED — ${err.message}. Pausing ${Math.round(s.backoffMs / 3600000)} h.`);
    } else {
      s.lastError = { at: new Date().toISOString(), message: err.message };
      log(`${name}: error — ${err.message}`);
    }
  } finally {
    await saveState(stateFile, state);
    await seen.save();
    if (!args.dryRun) await known.save(); // a dry run must not hide ads from the next real run
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateFile = path.join(args.out, 'state.json');
  const state = await loadState(stateFile);
  const seen = await SeenCache.load(path.join(args.out, 'seen.json'));
  const known = await KnownIds.load(path.join(args.out, 'known.json'));
  console.log(`[${stamp()}] sources: ${args.sources.join(', ')} | up to ${args.pages} pages | delay ~${args.delay} ms | ${args.dryRun ? 'DRY RUN' : 'ingest → API'}${args.once ? ' | once' : ''}${args.backfill ? ' | BACKFILL' : ''}${args.refresh ? ' | REFRESH' : ''} | known ids: ${known.size}`);

  await Promise.all(args.sources.map(async (name, i) => {
    await sleep(i * 5000); // stagger the first runs
    do {
      await runSource(name, args, state, stateFile, seen, known);
      if (args.once) break;
      await sleep(DISCOVERY_INTERVAL_MS * (0.85 + Math.random() * 0.3));
    } while (true); // eslint-disable-line no-constant-condition
  }));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
