import { fetchPage } from '../http.js';
import { deriveExternalId, propertyTypeFrom, roomsFrom, clip } from '../listing.js';
import { looksLikeAgency } from '../ownerSignals.js';
import { pageUntilKnown } from '../known.js';

// OLX — real-estate category pages, filtered to private sellers
// (search[private_business]=private) and sorted newest first. Each page
// embeds ~50 ads in window.__PRERENDERED_STATE__ with an explicit
// `isBusiness` flag and the full snapshot, so ad pages are never fetched.
// robots.txt (checked 2026-10-13) allows these paths for "*"; it disallows
// /api/, */ajax/, */rss/, contact pages — none of which we touch.

const BASE = 'https://www.olx.ro';
const CATEGORIES = [
  { path: 'apartamente-garsoniere-de-vanzare', type: 'buy' },
  { path: 'apartamente-garsoniere-de-inchiriat', type: 'rent' },
  { path: 'case-de-vanzare', type: 'buy' },
  { path: 'case-de-inchiriat', type: 'rent' },
  { path: 'terenuri', type: 'buy' },
  { path: 'birouri-spatii-comerciale', type: null },
];

const BS = String.fromCharCode(92);
function prerenderedState(html) {
  const i = html.indexOf('window.__PRERENDERED_STATE__');
  if (i < 0) return null;
  const start = html.indexOf('"', i);
  let j = start + 1;
  while (j < html.length) { if (html[j] === BS) { j += 2; continue; } if (html[j] === '"') break; j++; }
  try { return JSON.parse(JSON.parse(html.slice(start, j + 1))); } catch { return null; }
}

const param = (ad, re) => (ad.params || []).find((p) => re.test(p.key || ''));

function toSnapshot(ad, cat) {
  const text = `${ad.title || ''} ${ad.description || ''}`;
  const surface = param(ad, /^m$|suprafata|surface/i);
  const floor = param(ad, /^floor$|etaj/i);
  const roomsParam = param(ad, /rooms|camere/i);
  const priceValue = ad.price?.regularPrice?.value;
  const type = cat.type || (/inchiri|chiri/i.test(text) ? 'rent' : 'buy');
  return {
    source: 'olx',
    externalId: deriveExternalId(ad.url),
    sourceListingId: ad.id ? String(ad.id) : null,
    sourceUrl: ad.url,
    title: clip(ad.title, 300),
    description: clip(ad.description, 1200),
    type,
    price: Number.isFinite(priceValue) ? priceValue : null,
    currency: ad.price?.regularPrice?.currencyCode || null,
    city: ad.location?.cityName || null,
    county: ad.location?.regionName || null,
    address: [ad.location?.districtName, ad.location?.cityName].filter(Boolean).join(', ') || null,
    propertyType: propertyTypeFrom(cat.path) || propertyTypeFrom(ad.title),
    rooms: roomsFrom(roomsParam?.normalizedValue || roomsParam?.value) ?? roomsFrom(ad.title),
    surface: surface ? parseFloat(surface.normalizedValue ?? surface.value) || null : null,
    floor: floor ? clip(floor.normalizedValue ?? floor.value, 50) : null,
    imageUrl: ad.photos?.[0] ? String(ad.photos[0]).replace(/;s=\d+x\d+/, ';s=644x461') : null,
    publishedAt: ad.createdTime || null,
  };
}

export default {
  name: 'olx',
  // OLX answered 403 to a second page ~4 s after the first (2026-10-13):
  // give it a much slower pace. If it still blocks, the worker backs off.
  minDelayMs: 15000,
  async discover({ maxPages = 5, delayMs, known, log }) {
    const out = [];
    for (const cat of CATEGORIES) {
      out.push(...await pageUntilKnown({
        source: 'olx', known, maxPages, log, label: cat.path,
        fetchPageAds: async (page) => {
          const url = `${BASE}/imobiliare/${cat.path}/?search%5Bprivate_business%5D=private&search%5Border%5D=created_at:desc${page > 1 ? `&page=${page}` : ''}`;
          const { html, status } = await fetchPage(url, { delayMs, looksReal: (h) => h.includes('__PRERENDERED_STATE__') });
          if (status !== 200) return null;
          const ads = prerenderedState(html)?.listing?.listing?.ads;
          if (!Array.isArray(ads)) throw new Error(`OLX ${cat.path}: no ads parsed (page structure changed?)`);
          const listings = ads
            .filter((ad) => !ad.isBusiness && !looksLikeAgency(`${ad.title || ''} ${ad.description || ''}`))
            .map((ad) => toSnapshot(ad, cat));
          return { ids: ads.map((ad) => deriveExternalId(ad.url)), listings };
        },
      }));
    }
    return out;
  },
};
