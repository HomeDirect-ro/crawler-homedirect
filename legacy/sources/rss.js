import { BASE_URL, DEFAULT_USER_AGENT } from '../config.js';
import { extractTagText } from '../xml.js';

const RSS_URL = `${BASE_URL}/rss-listings.xml`;

// Bounded, safe default source — the last ~3-4k newly published/updated
// listings site-wide. No county/category fan-out, one request.
export async function fetchRssListingUrls(userAgent = DEFAULT_USER_AGENT) {
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': userAgent, Accept: 'application/rss+xml, application/xml' } });
  if (!res.ok) throw new Error(`RSS feed fetch failed: HTTP ${res.status}`);
  const xml = await res.text();
  const links = extractTagText(xml, 'link').filter((u) => u.includes('/oferta/'));
  return [...new Set(links)];
}
