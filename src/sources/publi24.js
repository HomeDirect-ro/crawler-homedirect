import { fetchPage } from '../http.js';
import { deriveExternalId, propertyTypeFrom, roomsFrom, decodeEntities, clip } from '../listing.js';
import { looksLikeOwner } from '../ownerSignals.js';
import { pageUntilKnown } from '../known.js';

// Publi24 — real-estate category pages. Each embeds a schema.org ItemList
// (JSON-LD) with ~20 ads: title, full description, URL, price, city,
// county, image — so ad pages are never fetched. robots.txt (2026-10-13)
// allows /anunturi/<category>/ for "*" (only "/anunturi/?" queries, /rss/,
// /DetailAd/ etc. are disallowed).
//
// Publi24 has NO seller-type flag (agents post as individuals), so an ad is
// kept only when its text reads like an owner's ("proprietar", "persoană
// fizică", "fără comision"…) and has no agency wording. Precision over
// recall: ambiguous ads are skipped.

const BASE = 'https://www.publi24.ro';
const CATEGORIES = [
  { path: 'de-vanzare/apartamente', type: 'buy' },
  { path: 'de-inchiriat/apartamente', type: 'rent' },
  { path: 'de-vanzare/case', type: 'buy' },
  { path: 'de-inchiriat/case', type: 'rent' },
  { path: 'de-vanzare/terenuri', type: 'buy' },
  { path: 'de-vanzare/spatii-comerciale', type: 'buy' },
];

function itemList(html) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    // The site leaves raw newlines inside JSON strings — invalid JSON, but
    // replacing every control char with a space is lossless here.
    const raw = m[1].replace(/[\u0000-\u001f]+/g, ' ');
    try {
      const j = JSON.parse(raw);
      if (j['@type'] === 'ItemList') return j.itemListElement || [];
    } catch { /* not the list */ }
  }
  return null;
}

function toSnapshot(item, cat) {
  const url = new URL(item.url, `${BASE}/`).href;
  const title = decodeEntities(item.name);
  const description = decodeEntities(item.description);
  const addr = item.offers?.availableAtOrFrom?.address || {};
  const price = parseFloat(item.offers?.price);
  return {
    source: 'publi24',
    externalId: deriveExternalId(url),
    sourceListingId: null,
    sourceUrl: url,
    title: clip(title, 300),
    description: clip(description, 1200),
    type: cat.type,
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: item.offers?.priceCurrency || null,
    city: decodeEntities(addr.addressLocality) || null,
    county: decodeEntities(addr.addressRegion) || null,
    address: decodeEntities(addr.addressLocality) || null,
    propertyType: propertyTypeFrom(url) || propertyTypeFrom(cat.path),
    rooms: roomsFrom(url) ?? roomsFrom(title),
    surface: (() => { const s = `${title} ${description}`.match(/(\d{2,4})\s*(?:mp|m2|m²|metri)/i); return s ? parseFloat(s[1]) : null; })(),
    floor: null,
    imageUrl: item.image?.[0]?.contentUrl || null,
    publishedAt: null,
  };
}

export default {
  name: 'publi24',
  async discover({ maxPages = 5, delayMs, known, log }) {
    const out = [];
    for (const cat of CATEGORIES) {
      out.push(...await pageUntilKnown({
        source: 'publi24', known, maxPages, log, label: cat.path,
        fetchPageAds: async (page) => {
          const url = `${BASE}/anunturi/imobiliare/${cat.path}/${page > 1 ? `?pag=${page}` : ''}`;
          const { html, status } = await fetchPage(url, { delayMs, looksReal: (h) => h.includes('"ItemList"') });
          if (status !== 200) return null;
          const items = itemList(html);
          if (!items) throw new Error(`Publi24 ${cat.path}: no ItemList parsed (page structure changed?)`);
          const listings = items
            .filter((it) => looksLikeOwner(`${decodeEntities(it.name)} ${decodeEntities(it.description)}`))
            .map((it) => toSnapshot(it, cat));
          return { ids: items.map((it) => deriveExternalId(new URL(it.url, `${BASE}/`).href)), listings };
        },
      }));
    }
    return out;
  },

  recheckVerdict({ status, html, finalUrl }) {
    if (status === 404 || status === 410) return 'gone';
    if (finalUrl && !/\/anunt\//.test(finalUrl)) return 'gone';
    if (/anun[tț]ul\s+(?:nu\s+mai\s+este|a\s+fost)\s+(?:activ|disponibil|dezactivat|șters|sters|expirat)/i.test(html)) return 'gone';
    return /application\/ld\+json/.test(html) ? 'alive' : null;
  },
  recheckLooksReal: (h) => h.includes('application/ld+json'),
};
