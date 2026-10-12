import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DELAY_MS, DEFAULT_LIMIT, DEFAULT_USER_AGENT, CONSECUTIVE_FAILURE_ABORT } from './config.js';
import { isAllowed } from './robots.js';
import { fetchRssListingUrls } from './sources/rss.js';
import { fetchSitemapListingUrls } from './sources/sitemap.js';
import { fetchListing, FETCH_RESULT, ChallengeDetectedError } from './fetchListing.js';
import { SeenCache } from './seenCache.js';
import { saveResults } from './output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { source: 'rss', limit: DEFAULT_LIMIT, delay: DEFAULT_DELAY_MS, out: path.join(__dirname, '..', 'output'), userAgent: DEFAULT_USER_AGENT, maxSitemaps: 3, recheck: false };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split(/=(.*)/s);
    switch (key) {
      case 'source': args.source = value; break;
      case 'limit': args.limit = parseInt(value, 10); break;
      case 'delay': args.delay = parseInt(value, 10); break;
      case 'out': args.out = path.resolve(value); break;
      case 'sitemap-filter': args.sitemapFilter = value; break;
      case 'max-sitemaps': args.maxSitemaps = parseInt(value, 10); break;
      case 'user-agent': args.userAgent = value; break;
      case 'recheck': args.recheck = true; break;
      default: break;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// +/-20% jitter — avoids a perfectly metronomic request interval, same
// courtesy any well-behaved crawler extends, not an attempt to hide.
function jittered(ms) {
  const spread = ms * 0.2;
  return Math.round(ms - spread + Math.random() * spread * 2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Source: ${args.source} | limit: ${args.limit} | delay: ~${args.delay}ms | out: ${args.out}`);

  const candidateUrls = args.source === 'sitemap'
    ? await fetchSitemapListingUrls({ filter: args.sitemapFilter, maxSitemaps: args.maxSitemaps, userAgent: args.userAgent })
    : await fetchRssListingUrls(args.userAgent);

  console.log(`Found ${candidateUrls.length} candidate listing URLs.`);

  const seenCache = await SeenCache.load(path.join(args.out, 'seen.json'));
  const toVisit = candidateUrls.filter((url) => isAllowed(url) && (args.recheck || !seenCache.has(url)));
  console.log(`${toVisit.length} not yet checked (or --recheck set). Visiting up to ${args.limit} this run.`);

  const matches = [];
  let checked = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = null;

  for (const url of toVisit.slice(0, args.limit)) {
    try {
      const { result, listing } = await fetchListing(url, { userAgent: args.userAgent });
      checked++;
      consecutiveFailures = 0;
      seenCache.record(url, result);

      if (result === FETCH_RESULT.PRIVATE_OWNER) {
        matches.push(listing);
        console.log(`[${checked}] PRIVATE OWNER — ${listing.title || url}`);
      } else if (result === FETCH_RESULT.AGENCY) {
        console.log(`[${checked}] agency — skip`);
      } else if (result === FETCH_RESULT.GONE) {
        console.log(`[${checked}] gone (404) — skip`);
      } else {
        console.log(`[${checked}] owner type unrecognized — skip`);
      }
    } catch (err) {
      if (err instanceof ChallengeDetectedError) {
        console.error(`\nSTOPPING: ${err.message}\nURL: ${err.url}`);
        stoppedEarly = 'challenge';
        break;
      }
      consecutiveFailures++;
      console.warn(`[warn] ${err.message}`);
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
        console.error(`\nSTOPPING: ${consecutiveFailures} consecutive failures — likely blocked rather than a few one-off pages.`);
        stoppedEarly = 'consecutive_failures';
        break;
      }
    }

    await sleep(jittered(args.delay));
  }

  await seenCache.save();
  const { jsonPath, csvPath, total } = await saveResults(args.out, matches);

  console.log(`\nChecked ${checked} pages this run. Found ${matches.length} new private-owner listings.`);
  console.log(`Master file now has ${total} private-owner listings total.`);
  console.log(`JSON: ${jsonPath}\nCSV:  ${csvPath}`);
  if (stoppedEarly) {
    console.log(`\nRun stopped early (${stoppedEarly}) — re-run later to continue; already-checked URLs are cached and won't be re-fetched.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
