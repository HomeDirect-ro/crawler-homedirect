import { fetchPage } from '../http.js';
import { deriveExternalId, propertyTypeFrom, roomsFrom, decodeEntities, clip } from '../listing.js';
import { looksLikeOwner } from '../ownerSignals.js';
import { pageUntilKnown } from '../known.js';

// Publi24 — real-estate category pages. Each embeds a schema.org ItemList
// (JSON-LD) with ~20 ads: title, full description, URL, price, image — so
// ad pages are never fetched. The JSON-LD address is only there in some
// categories (none of the land ads have it), so the location and surface
// come from the visible card instead ("article-location": "Area, City,
// County"; "article-lbl-txt": "… | 321 m²"), JSON-LD as a fallback. robots.txt (2026-10-13)
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

const parseRoNumber = (raw) => {
  const s = String(raw).replace(/[.,]$/, '');
  const n = /^\d{1,3}([.,]\d{3})+$/.test(s) ? parseFloat(s.replace(/[.,]/g, '')) : parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Card details keyed by ad URL path: { location: [parts], surface }.
function cardDetails(html) {
  const out = new Map();
  const re = /<h2 class="article-title">\s*<a href="([^"]+)"[\s\S]*?(?=<h2 class="article-title">|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const loc = block.match(/<p class="article-location">[\s\S]*?<span>([^<]+)<\/span>/);
    const lbl = block.match(/<span class="article-lbl-txt">([\s\S]*?)<\/span>/);
    // "0,02 EUR/m² | 3,611 m²": the surface is the part after "|". A "," or
    // "." followed by exactly 3 digits is a thousands separator (3,611 =
    // 3611, 5.800 = 5800); otherwise a decimal (48,5 = 48.5).
    const surfText = lbl ? lbl[1].replace(/<[^>]+>/g, '').split('|').pop() : '';
    const surf = surfText.match(/(\d[\d.,]*)\s*m2?\b/i);
    const key = new URL(m[1], `${BASE}/`).pathname;
    out.set(key, {
      location: loc ? decodeEntities(loc[1]).split(',').map((x) => x.trim()).filter(Boolean) : null,
      surface: surf ? parseRoNumber(surf[1]) : null,
    });
  }
  return out;
}
const titleCase = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : s);

function toSnapshot(item, cat, card) {
  const url = new URL(item.url, `${BASE}/`).href;
  const title = decodeEntities(item.name);
  const description = decodeEntities(item.description);
  const addr = item.offers?.availableAtOrFrom?.address || {};
  const price = parseFloat(item.offers?.price);
  // Card "Area, City, County" (or "City, County") → county = last, city = the one before.
  const parts = card?.location || [];
  const cardCounty = parts.length >= 2 ? parts[parts.length - 1] : null;
  const cardCity = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || null;
  const city = decodeEntities(addr.addressLocality) || titleCase(cardCity) || null;
  const county = decodeEntities(addr.addressRegion) || titleCase(cardCounty) || null;
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
    city,
    county,
    address: parts.length ? parts.map(titleCase).join(', ') : city,
    // The category is authoritative (an ad under /terenuri/ is land even
    // when its URL says "teren-ptr-casa"); the URL only fills gaps.
    propertyType: propertyTypeFrom(cat.path) || propertyTypeFrom(url),
    rooms: roomsFrom(url) ?? roomsFrom(title),
    surface: card?.surface || (() => { const s = `${title} ${description}`.match(/(\d{2,4})\s*(?:mp|m2|m²|metri)/i); return s ? parseFloat(s[1]) : null; })(),
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
          const cards = cardDetails(html);
          const listings = items
            .filter((it) => looksLikeOwner(`${decodeEntities(it.name)} ${decodeEntities(it.description)}`))
            .map((it) => toSnapshot(it, cat, cards.get(new URL(it.url, `${BASE}/`).pathname)));
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

// For tests / one-off checks (scripts read a saved category page).
export const _internals = { itemList, cardDetails, toSnapshot, CATEGORIES };
