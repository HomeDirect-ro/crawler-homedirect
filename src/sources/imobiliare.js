import { fetchPage } from '../http.js';
import { extractTagText } from '../xml.js';
import { extractListing } from '../jsonld.js';
import { deriveExternalId, propertyTypeFrom, clip } from '../listing.js';
import { looksLikeAgency } from '../ownerSignals.js';

// Imobiliare.ro — the site's own RSS feed of newly published listings
// (/rss-listings.xml, allowed by robots.txt), then each NEW ad page once:
// its schema.org JSON-LD says who's selling (offeredBy @type "Person" =
// private owner, "RealEstateAgent" = agency). Search/filter URLs are
// disallowed by robots.txt, so there's no category shortcut here — the
// per-run `limit` keeps the number of ad pages small, and `seen` (persisted
// by the worker) makes sure no ad page is fetched twice.

const BASE = 'https://www.imobiliare.ro';

export default {
  name: 'imobiliare',
  async discover({ delayMs, limit = 60, seen, log }) {
    const { html: xml } = await fetchPage(`${BASE}/rss-listings.xml`, { delayMs, accept: 'application/rss+xml, application/xml', looksReal: (h) => h.includes('<rss') || h.includes('<item') });
    const links = [...new Set(extractTagText(xml, 'link').filter((u) => u.includes('/oferta/')))];
    const fresh = links.filter((u) => !seen?.has(u)).slice(0, limit);
    log?.(`imobiliare rss: ${links.length} links, ${fresh.length} new to check`);
    const out = [];
    for (const url of fresh) {
      const { html, status } = await fetchPage(url, { delayMs, looksReal: (h) => h.includes('application/ld+json') });
      seen?.record(url, status === 200 ? 'checked' : `http-${status}`);
      if (status !== 200) continue;
      const { ownerType, listing } = extractListing(html, url);
      if (!listing || ownerType !== 'Person') continue;
      if (looksLikeAgency(`${listing.title || ''} ${listing.description || ''}`)) continue;
      const digits = url.split('?')[0].match(/-(\d{6,})\/?$/);
      // listing.ownerName is deliberately NOT forwarded (no personal data in the feed).
      out.push({
        source: 'imobiliare',
        externalId: deriveExternalId(url),
        sourceListingId: digits ? digits[1] : null,
        sourceUrl: url,
        title: clip(listing.title, 300),
        description: clip(listing.description, 1200),
        type: listing.type,
        price: listing.price,
        currency: listing.currency,
        city: listing.city,
        county: null,
        address: listing.address,
        propertyType: propertyTypeFrom(url) || propertyTypeFrom(listing.title),
        rooms: listing.rooms,
        surface: listing.surface,
        floor: null,
        imageUrl: null,
        publishedAt: null,
      });
    }
    log?.(`imobiliare: ${out.length} private of ${fresh.length} checked`);
    return out;
  },
};
