import { fetchPage } from '../http.js';
import { deriveExternalId, clip } from '../listing.js';
import { looksLikeAgency } from '../ownerSignals.js';
import { pageUntilKnown } from '../known.js';

// Storia — search pages filtered to private owners
// (ownerTypeSingleSelect=PRIVATE), newest first. The Next.js __NEXT_DATA__
// carries ~36 ads per page with `isPrivateOwner` and the full snapshot, so
// ad pages are never fetched. robots.txt (2026-10-13) allows these paths for
// "*". Storia also sends `Content-Signal: ai-train=no, ai-input=no` — this
// data is for agencies' prospecting only and must NOT be fed to AI features.

const BASE = 'https://www.storia.ro';
// Only searches where Storia actually applies the private-owner filter
// (checked 2026-10-13 via pageProps.filteringQueryParams): on rent and land
// searches it silently drops ownerTypeSingleSelect and returns ~95% agency
// ads, so those would cost requests for almost nothing — rentals come from
// OLX/Publi24/extension captures instead.
const SEARCHES = [
  { tx: 'vanzare', estate: 'apartament' },
  { tx: 'vanzare', estate: 'casa' },
  { tx: 'vanzare', estate: 'spatiu-comercial' },
];

const ESTATE = { FLAT: 'apartment', HOUSE: 'house', TERRAIN: 'land', COMMERCIAL_PROPERTY: 'commercial', OFFICE: 'office', GARAGE: 'garage', HALL: 'industrial', ROOM: 'room' };
const ROOMS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, MORE: 10 };
const FLOOR = { CELLAR: 'subsol', GROUND: 'parter', FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10', ABOVE_TENTH: '>10', GARRET: 'mansarda' };

function nextData(html) {
  const s = html.indexOf('id="__NEXT_DATA__"');
  if (s < 0) return null;
  const a = html.indexOf('>', s) + 1;
  const b = html.indexOf('</script>', a);
  try { return JSON.parse(html.slice(a, b)); } catch { return null; }
}

function toSnapshot(ad) {
  const locs = ad.location?.reverseGeocoding?.locations || [];
  const level = (re) => locs.find((l) => re.test(l.locationLevel || ''))?.name || null;
  // Levels seen: county, county_capital, municipality, town, commune, village, sector, district.
  // Bucharest has no city level, just county > sector > district.
  const city = level(/county_capital|municipality|^city$|town|commune|village/) || (level(/^sector$/) ? 'Bucuresti' : null) || ad.location?.address?.city?.name || null;
  const price = ad.transaction === 'RENT' ? (ad.rentPrice || ad.totalPrice) : ad.totalPrice;
  const url = `${BASE}/ro/oferta/${ad.slug}`;
  return {
    source: 'storia',
    externalId: deriveExternalId(url),
    sourceListingId: ad.id ? String(ad.id) : null,
    sourceUrl: url,
    title: clip(ad.title, 300),
    description: clip(ad.shortDescription, 1200),
    type: ad.transaction === 'RENT' ? 'rent' : 'buy',
    price: Number.isFinite(price?.value) ? price.value : null,
    currency: price?.currency || null,
    city,
    county: level(/^county$/),
    address: [level(/district|sector|residential/), city].filter(Boolean).join(', ') || null,
    propertyType: ESTATE[ad.estate] || null,
    rooms: ROOMS[ad.roomsNumber] ?? null,
    surface: Number.isFinite(ad.areaInSquareMeters) ? ad.areaInSquareMeters : null,
    floor: FLOOR[ad.floorNumber] || null,
    imageUrl: ad.images?.[0]?.medium || null,
    publishedAt: ad.createdAtFirst || ad.dateCreated || null,
  };
}

export default {
  name: 'storia',
  async discover({ maxPages = 5, delayMs, known, log }) {
    const out = [];
    for (const s of SEARCHES) {
      out.push(...await pageUntilKnown({
        source: 'storia', known, maxPages, log, label: `${s.tx}/${s.estate}`,
        fetchPageAds: async (page) => {
          const url = `${BASE}/ro/rezultate/${s.tx}/${s.estate}/toata-romania?ownerTypeSingleSelect=PRIVATE&by=LATEST&direction=DESC${page > 1 ? `&page=${page}` : ''}`;
          const { html, status } = await fetchPage(url, { delayMs, looksReal: (h) => h.includes('__NEXT_DATA__') && h.includes('searchAds') });
          if (status !== 200) return null;
          const data = nextData(html)?.props?.pageProps?.data?.searchAds;
          if (!Array.isArray(data?.items)) throw new Error(`Storia ${s.tx}/${s.estate}: no ads parsed (page structure changed?)`);
          if (data.pagination && page > (data.pagination.totalPages || 1)) return null;
          const listings = data.items
            .filter((ad) => ad.isPrivateOwner && !ad.agency && !looksLikeAgency(`${ad.title || ''} ${ad.shortDescription || ''}`))
            .map(toSnapshot);
          return { ids: data.items.map((ad) => deriveExternalId(`${BASE}/ro/oferta/${ad.slug}`)), listings };
        },
      }));
    }
    return out;
  },

  // Is a known listing still online? Storia keeps expired ads reachable but
  // flags them (ad.status / shouldShowExpiredAdPage) or redirects away.
  recheckVerdict({ status, html, finalUrl }) {
    if (status === 404 || status === 410) return 'gone';
    if (finalUrl && !/\/oferta\//.test(finalUrl)) return 'gone';
    const ad = nextData(html)?.props?.pageProps?.ad;
    if (!ad) return null; // can't tell — leave it
    if (ad.shouldShowExpiredAdPage || (ad.status && ad.status !== 'active')) return 'gone';
    return 'alive';
  },
  recheckLooksReal: (h) => h.includes('__NEXT_DATA__'),
};
