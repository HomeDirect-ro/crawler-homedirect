import { BASE_URL, DEFAULT_USER_AGENT } from '../config.js';
import { extractTagText } from '../xml.js';

const INDEX_URL = `${BASE_URL}/sitemap-listings-index-ro.xml`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchXml(url, userAgent) {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`Sitemap fetch failed for ${url}: HTTP ${res.status}`);
  return res.text();
}

// Broader (opt-in) source: the site's per-category-per-county sitemap files.
// `filter` narrows which leaf sitemap filenames to actually fetch (e.g.
// "bucuresti", "apartments-for-sale") — without it this would otherwise
// fan out into hundreds of files, which is exactly the kind of broad,
// scripted crawl we're deliberately avoiding. `maxSitemaps` is a second,
// hard safety cap regardless of how many the filter matches.
export async function fetchSitemapListingUrls({ filter = null, maxSitemaps = 3, delayMs = 1500, userAgent = DEFAULT_USER_AGENT } = {}) {
  const indexXml = await fetchXml(INDEX_URL, userAgent);
  let leafUrls = extractTagText(indexXml, 'loc');
  if (filter) {
    const needle = filter.toLowerCase();
    leafUrls = leafUrls.filter((u) => u.toLowerCase().includes(needle));
  }
  if (leafUrls.length > maxSitemaps) {
    console.warn(`Sitemap filter matched ${leafUrls.length} files — capping to the first ${maxSitemaps} (raise --max-sitemaps to fetch more).`);
    leafUrls = leafUrls.slice(0, maxSitemaps);
  }

  const listingUrls = new Set();
  for (const leafUrl of leafUrls) {
    const xml = await fetchXml(leafUrl, userAgent);
    extractTagText(xml, 'loc').filter((u) => u.includes('/oferta/')).forEach((u) => listingUrls.add(u));
    await sleep(delayMs);
  }
  return [...listingUrls];
}
