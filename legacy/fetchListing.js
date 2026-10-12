import { BASE_URL, DEFAULT_USER_AGENT } from './config.js';
import { extractListing } from './jsonld.js';

export class ChallengeDetectedError extends Error {
  constructor(message, { status, url }) {
    super(message);
    this.name = 'ChallengeDetectedError';
    this.status = status;
    this.url = url;
  }
}

// Signals DataDome (or a generic captcha/interstitial) is serving instead
// of the real page. We deliberately do NOT try to solve or work around
// this — detecting it is only so the run can stop cleanly.
const CHALLENGE_BODY_RE = /captcha-delivery\.com|geo\.captcha|please enable js[^<]*disable any ad ?blocker|datadome/i;

export const FETCH_RESULT = {
  PRIVATE_OWNER: 'private_owner',
  AGENCY: 'agency',
  UNKNOWN_OWNER: 'unknown_owner', // parsed fine, owner type unrecognized
  GONE: 'gone', // 404/410 — listing no longer exists, not a block
};

// Fetches one listing page and classifies it. Throws ChallengeDetectedError
// when it looks like a bot-detection wall rather than the real page —
// callers should stop the run, not retry.
export async function fetchListing(url, { userAgent = DEFAULT_USER_AGENT } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml',
      Referer: `${BASE_URL}/`,
    },
    redirect: 'follow',
  });

  if (res.status === 404 || res.status === 410) {
    return { result: FETCH_RESULT.GONE };
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new ChallengeDetectedError(`Blocked with HTTP ${res.status} — stopping rather than retrying/evading.`, { status: res.status, url });
  }
  if (!res.ok) {
    throw new Error(`Unexpected HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  if (CHALLENGE_BODY_RE.test(html)) {
    throw new ChallengeDetectedError('Response body looks like a DataDome/CAPTCHA challenge page — stopping rather than retrying/evading.', { status: res.status, url });
  }

  const { ownerType, listing } = extractListing(html, url);
  if (!listing) {
    // No JSON-LD at all and no explicit challenge markers — could be a
    // template change or a one-off oddity. Treated as a soft failure by
    // the caller (counts toward the consecutive-failure abort streak).
    throw new Error(`No JSON-LD found on ${url} (page structure may have changed, or this is a soft block).`);
  }

  if (ownerType === 'Person') return { result: FETCH_RESULT.PRIVATE_OWNER, listing };
  if (ownerType === 'RealEstateAgent') return { result: FETCH_RESULT.AGENCY, listing };
  return { result: FETCH_RESULT.UNKNOWN_OWNER, listing };
}
